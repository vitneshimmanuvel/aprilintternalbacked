const pool = require('../config/db');
const { sendEmail } = require('../services/email');

/**
 * GET /api/public/form/:boardId
 * Returns the public form config for a board (no auth required)
 */
const getPublicForm = async (req, res, next) => {
  try {
    const { boardId } = req.params;

    const boardResult = await pool.query('SELECT id, name FROM boards WHERE id = $1', [boardId]);
    if (!boardResult.rows[0]) return res.status(404).json({ message: 'Form not found' });

    const settingsResult = await pool.query(
      "SELECT value FROM settings WHERE board_id = $1 AND key = 'lead_form_config'",
      [boardId]
    );

    let formConfig = null;
    if (settingsResult.rows[0]) {
      formConfig = typeof settingsResult.rows[0].value === 'string'
        ? JSON.parse(settingsResult.rows[0].value)
        : settingsResult.rows[0].value;
    }

    if (!formConfig || !formConfig.enabled) {
      return res.status(404).json({ message: 'This form is not currently active' });
    }

    res.json({
      boardName: boardResult.rows[0].name,
      formTitle: formConfig.title || `${boardResult.rows[0].name} — Enquiry Form`,
      formDescription: formConfig.description || 'Please fill in your details and we will get back to you shortly.',
      fields: formConfig.fields || [],
      successMessage: formConfig.successMessage || 'Thank you! We have received your enquiry and will contact you soon.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/public/form/:boardId/submit
 * Receives a public form submission:
 *   - Merges fields that map to same lead field (comma-separated)
 *   - Creates a lead in the pipeline
 *   - Emails all board managers/admins
 *   - Optionally emails the submitter (if email field present & sendConfirmationEmail is on)
 */
const submitPublicForm = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { boardId } = req.params;

    // ── Validate board ──
    const boardResult = await client.query('SELECT id, name FROM boards WHERE id = $1', [boardId]);
    if (!boardResult.rows[0]) return res.status(404).json({ message: 'Form not found' });

    // ── Load form config ──
    const settingsResult = await client.query(
      "SELECT value FROM settings WHERE board_id = $1 AND key = 'lead_form_config'",
      [boardId]
    );
    let formConfig = null;
    if (settingsResult.rows[0]) {
      formConfig = typeof settingsResult.rows[0].value === 'string'
        ? JSON.parse(settingsResult.rows[0].value)
        : settingsResult.rows[0].value;
    }
    if (!formConfig || !formConfig.enabled) {
      return res.status(404).json({ message: 'This form is not currently active' });
    }

    const submittedData = req.body || {};
    const configFields = formConfig.fields || [];

    // ── Accumulate values for each lead field (handles many-to-one mapping) ──
    // Structure: { leadFieldKey: [value1, value2, ...] }
    const systemFieldAccumulator = {
      client_name:    [],
      client_email:   [],
      client_phone:   [],
      client_company: [],
      title:          [],
      description:    [],
    };
    const customData = {};

    for (const fieldDef of configFields) {
      const fieldKey = fieldDef.id;          // key used in the submitted form body
      const systemKey = fieldDef.systemKey;   // which lead field it maps to (if any)
      const rawValue = (submittedData[fieldKey] || '').toString().trim();

      if (!rawValue) continue; // skip empty answers

      if (systemKey && systemFieldAccumulator.hasOwnProperty(systemKey)) {
        // Map into a standard lead column — accumulate so we can join later
        systemFieldAccumulator[systemKey].push(rawValue);
      } else {
        // Store in custom_data using the explicit systemKey if provided (which maps to custom field id), 
        // otherwise fallback to a slugified label
        const labelKey = systemKey || (fieldDef.label || fieldKey).replace(/\s+/g, '_').toLowerCase();
        if (customData[labelKey]) {
          // Another field already stored here — comma-join
          customData[labelKey] = `${customData[labelKey]}, ${rawValue}`;
        } else {
          customData[labelKey] = rawValue;
        }
      }
    }

    // ── Join accumulated system field values with comma ──
    const joinField = (arr) => arr.length > 0 ? arr.join(', ') : null;

    const clientName    = joinField(systemFieldAccumulator.client_name)    || 'Unknown';
    const clientEmail   = joinField(systemFieldAccumulator.client_email);
    const clientPhone   = joinField(systemFieldAccumulator.client_phone);
    const clientCompany = joinField(systemFieldAccumulator.client_company);
    const leadTitle     = joinField(systemFieldAccumulator.title)           || `Enquiry from ${clientName}`;
    const description   = joinField(systemFieldAccumulator.description);

    // ── Get first pipeline stage ──
    let firstStage = 'meeting';
    const stagesResult = await client.query(
      "SELECT value FROM settings WHERE board_id = $1 AND key = 'stages'",
      [boardId]
    );
    if (stagesResult.rows[0]) {
      try {
        const stages = typeof stagesResult.rows[0].value === 'string'
          ? JSON.parse(stagesResult.rows[0].value)
          : stagesResult.rows[0].value;
        if (stages && stages.length > 0) firstStage = stages[0].id;
      } catch (_) {}
    }

    // ── Resolve created_by (admin or first board member) ──
    let createdBy = null;
    const adminResult = await client.query(
      `SELECT u.id FROM users u 
       JOIN board_users bu ON bu.user_id = u.id 
       WHERE bu.board_id = $1 AND (u.role = 'admin' OR bu.role = 'admin')
       LIMIT 1`,
      [boardId]
    );
    if (adminResult.rows[0]) {
      createdBy = adminResult.rows[0].id;
    } else {
      const memberResult = await client.query(
        'SELECT user_id FROM board_users WHERE board_id = $1 LIMIT 1',
        [boardId]
      );
      if (memberResult.rows[0]) createdBy = memberResult.rows[0].user_id;
    }

    if (!createdBy) {
      return res.status(500).json({ message: 'Board has no members. Cannot create lead.' });
    }

    // ── Insert lead ──
    const assignee = formConfig.defaultAssignee || null;
    const leadResult = await client.query(
      `INSERT INTO leads 
        (title, client_name, client_email, client_phone, client_company, description, priority, created_by, assigned_to, board_id, custom_data, stage)
       VALUES ($1, $2, $3, $4, $5, $6, 'medium', $7, $8, $9, $10, $11) RETURNING *`,
      [leadTitle, clientName, clientEmail, clientPhone, clientCompany, description, createdBy, assignee, boardId, customData, firstStage]
    );
    const lead = leadResult.rows[0];

    // ── History + initial note ──
    await client.query(
      `INSERT INTO lead_history (lead_id, user_id, action, details) VALUES ($1, $2, 'created', $3)`,
      [lead.id, createdBy, JSON.stringify({ source: 'public_form', title: leadTitle, initial_stage: firstStage })]
    );
    await client.query(
      `INSERT INTO lead_notes (lead_id, user_id, stage, content, original_content) VALUES ($1, $2, $3, $4, $4)`,
      [lead.id, createdBy, firstStage, `Lead submitted via public enquiry form by ${clientName}`]
    );

    await client.query('COMMIT');

    const boardName = boardResult.rows[0].name;

    // ── Build field summary rows for emails ──
    const fieldRows = configFields
      .map(fd => {
        const val = (submittedData[fd.id] || '').toString().trim();
        if (!val) return null;
        return `<div style="display:flex;margin-bottom:8px;">
          <span style="font-size:12px;color:#6b7280;width:140px;flex-shrink:0;">${fd.label || fd.id}</span>
          <span style="font-size:14px;color:#111827;font-weight:500;">${val}</span>
        </div>`;
      })
      .filter(Boolean)
      .join('');

    const notifHtml = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:24px 30px;">
          <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">New Enquiry Received</h1>
          <p style="color:#dbeafe;margin:6px 0 0;font-size:13px;">${boardName} — LeadFlow</p>
        </div>
        <div style="padding:28px 30px;">
          <p style="font-size:15px;color:#374151;margin:0 0 18px;">A new lead has been submitted via the public form and added to your pipeline.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;margin-bottom:20px;">
            ${fieldRows}
          </div>
          <p style="font-size:13px;color:#6b7280;margin:0;">Log in to <strong>LeadFlow</strong> to view and assign this lead.</p>
        </div>
        <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 30px;">
          <p style="font-size:11px;color:#9ca3af;margin:0;text-align:center;">Automated notification · LeadFlow · ${boardName}</p>
        </div>
      </div>`;

    // ── Email all board managers/admins + additional emails ──
    try {
      const emailsToNotify = new Set();
      
      const managersResult = await pool.query(
        `SELECT u.email FROM users u
         JOIN board_users bu ON bu.user_id = u.id
         WHERE bu.board_id = $1 AND (u.role = 'admin' OR u.role = 'manager' OR bu.role = 'admin')`,
        [boardId]
      );
      managersResult.rows.forEach(m => {
        if (m.email) emailsToNotify.add(m.email);
      });

      if (assignee) {
        const assigneeRes = await pool.query('SELECT email FROM users WHERE id = $1', [assignee]);
        if (assigneeRes.rows[0]?.email) emailsToNotify.add(assigneeRes.rows[0].email);
      }

      // Add extra notification emails from config
      if (formConfig.notificationEmails) {
        formConfig.notificationEmails.split(',').forEach(em => {
          const trimmed = em.trim();
          if (trimmed) emailsToNotify.add(trimmed);
        });
      }

      for (const email of emailsToNotify) {
        await sendEmail(
          email,
          `New Enquiry: ${clientName} — ${boardName}`,
          `New lead from form: ${clientName} (${clientEmail || clientPhone || 'no contact info'})`,
          notifHtml
        );
        console.log(`📧 Notification sent: ${email}`);
      }
    } catch (emailErr) {
      console.error('Error sending manager notification emails:', emailErr);
    }

    // ── Email submitter confirmation if enabled ──
    if (formConfig.sendConfirmationEmail && clientEmail) {
      try {
        const confirmHtml = `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
            <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:24px 30px;">
              <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Enquiry Received</h1>
              <p style="color:#dbeafe;margin:6px 0 0;font-size:13px;">${boardName}</p>
            </div>
            <div style="padding:28px 30px;">
              <p style="font-size:15px;color:#374151;margin:0 0 18px;">Hi ${clientName},</p>
              <p style="font-size:15px;color:#374151;margin:0 0 18px;">Thank you for contacting us. We have successfully received your enquiry and our team will get back to you shortly.</p>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;margin-bottom:20px;">
                <p style="margin:0;font-size:14px;color:#4b5563;"><strong>Details:</strong></p>
                ${fieldRows}
              </div>
            </div>
          </div>`;
        await sendEmail(
          clientEmail,
          `We have received your enquiry — ${boardName}`,
          `Hi ${clientName}, thank you for your enquiry. We will get back to you soon.`,
          confirmHtml
        );
        console.log(`📧 Submitter confirmation sent to: ${clientEmail}`);
      } catch (err) {
        console.error('Error sending submitter confirmation email:', err);
      }
    }

    res.status(201).json({
      success: true,
      message: formConfig.successMessage || 'Thank you! We have received your enquiry.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

module.exports = { getPublicForm, submitPublicForm };
