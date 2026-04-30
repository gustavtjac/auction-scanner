require('dotenv').config();
const { Resend } = require('resend');

// Reads items from stdin as a JSON array, then sends the email.
// Usage: echo '[...]' | node mailer.js
async function main() {
  const raw = await new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (buf += chunk));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });

  const items = JSON.parse(raw);
  if (!items.length) {
    console.log('[mailer] No items, skipping email.');
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const recipient = process.env.RECIPIENT_EMAIL;

  const itemsHtml = items.map(item => `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;background:#ffffff;border-radius:10px;border:1px solid #e8e0d5;overflow:hidden;">
      <tr>
        ${item.imageUrl ? `<td width="150" valign="top" style="padding:0;vertical-align:top;"><img src="${item.imageUrl}" width="150" style="display:block;width:150px;height:150px;" /></td>` : ''}
        <td valign="top" style="padding:20px 24px;vertical-align:top;">
          <p style="margin:0 0 5px;font-size:10px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#b8945a;font-family:Verdana,Geneva,sans-serif;">${item.source}</p>
          <h2 style="margin:0 0 6px;font-size:17px;font-weight:700;color:#1a1a1a;line-height:1.3;font-family:Georgia,'Times New Roman',serif;">${item.title}</h2>
          <p style="margin:0 0 12px;font-size:12px;color:#999;font-family:Verdana,Geneva,sans-serif;">&#128205; ${item.location}${item.endsAt ? `&nbsp;&nbsp;&#128336;&nbsp;Hammerslag: ${item.endsAt}` : ''}</p>
          <p style="margin:0 0 12px;font-size:24px;font-weight:700;line-height:1;font-family:Georgia,'Times New Roman',serif;color:${item.price === 0 ? '#aaa' : '#b8945a'};">
            ${item.price === 0 ? '<span style="font-size:15px;font-style:italic;">Ingen bud endnu</span>' : `${item.price.toLocaleString('da-DK')} DKK`}
          </p>
          ${item.description ? `<p style="margin:0 0 10px;font-size:12px;color:#777;font-family:Verdana,Geneva,sans-serif;line-height:1.6;">${item.description.slice(0, 300)}${item.description.length > 300 ? '…' : ''}</p>` : ''}
          ${item.reason ? `<p style="margin:0 0 16px;font-size:13px;color:#555;font-style:italic;font-family:Georgia,'Times New Roman',serif;line-height:1.55;padding-left:10px;border-left:3px solid #b8945a;">${item.reason}</p>` : ''}
          <a href="${item.url}" style="display:inline-block;padding:9px 20px;background:#1c1c2e;color:#c8a96e;font-family:Verdana,Geneva,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.08em;text-decoration:none;border-radius:5px;text-transform:uppercase;">Se Lot &#8594;</a>
        </td>
      </tr>
    </table>
  `).join('');

  const dateStr = new Date().toLocaleDateString('da-DK', { dateStyle: 'full' });
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2ede6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2ede6;">
    <tr><td align="center" style="padding:32px 12px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- header -->
        <tr><td style="background:#1c1c2e;border-radius:12px 12px 0 0;padding:36px 36px 30px;">
          <p style="margin:0 0 6px;font-size:10px;font-weight:bold;letter-spacing:0.18em;text-transform:uppercase;color:#b8945a;font-family:Verdana,Geneva,sans-serif;">Auktionsscanner</p>
          <h1 style="margin:0 0 10px;font-size:34px;font-weight:700;color:#f5f0e8;font-family:Georgia,'Times New Roman',serif;line-height:1.1;">Dagens Gode Fund</h1>
          <p style="margin:0;font-size:13px;color:#7a7a8c;font-family:Verdana,Geneva,sans-serif;">${items.length} ${items.length === 1 ? 'fund' : 'fund'} fundet &nbsp;&middot;&nbsp; ${dateStr}</p>
        </td></tr>

        <!-- gold rule -->
        <tr><td style="background:linear-gradient(90deg,#b8945a,#e0c07a,#b8945a);height:3px;"></td></tr>

        <!-- items -->
        <tr><td style="padding:24px 24px 8px;">
          ${itemsHtml}
        </td></tr>

        <!-- footer -->
        <tr><td style="padding:16px 24px 28px;text-align:center;border-top:1px solid #ddd5c8;">
          <p style="margin:0;font-size:11px;color:#b0a898;font-family:Verdana,Geneva,sans-serif;letter-spacing:0.04em;">Sendt af Auktionsscanner &nbsp;&middot;&nbsp; Kun de bedste fund</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  await resend.emails.send({
    from: 'Auction Scanner <onboarding@resend.dev>',
    to: recipient,
    subject: `${items.length} gode fund fra dagens auktioner`,
    html,
  });

  console.log(`[mailer] Sent to ${recipient} (${items.length} items)`);
}

main().catch(err => {
  console.error('[mailer] Fatal:', err.message);
  process.exit(1);
});
