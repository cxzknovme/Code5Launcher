const nodemailer = require('nodemailer');

class Mailer {
  constructor(config) {
    this.config = config;
    this.transport = config.mode === 'smtp'
      ? nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: { user: config.user, pass: config.pass }
        })
      : null;
  }

  async verify() {
    if (this.transport) await this.transport.verify();
  }

  async sendCode({ email, code, purpose }) {
    const isReset = purpose === 'reset';
    const subject = isReset ? 'Восстановление аккаунта Code5' : 'Код регистрации Code5';
    const displayCode = code.split('').join(' ');
    if (!this.transport) return { devCode: code };

    await this.transport.sendMail({
      from: this.config.from,
      to: email,
      subject,
      text: `Ваш код Code5: ${code}. Код действует ограниченное время.`,
      html: `<!doctype html>
<html lang="ru">
  <body style="margin:0;background:#0a0b0e;color:#f4f1e8;font-family:Segoe UI,Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0b0e;padding:36px 16px">
      <tr><td align="center">
        <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:520px;border:1px solid #292b31;background:#14161b">
          <tr><td style="padding:28px 32px;border-bottom:1px solid #292b31;color:#e0ad31;font-size:13px;font-weight:700">CODE5</td></tr>
          <tr><td style="padding:34px 32px">
            <h1 style="margin:0 0 12px;font-size:24px;color:#f4f1e8">${isReset ? 'Восстановление пароля' : 'Подтвердите регистрацию'}</h1>
            <p style="margin:0 0 24px;color:#a7a9b0;font-size:14px;line-height:1.6">Введите этот код в лаунчере. Никому его не сообщайте.</p>
            <div style="padding:18px;border:1px solid #574720;background:#1d1a11;color:#f2c95c;font-size:34px;font-weight:800;letter-spacing:0;text-align:center">${displayCode}</div>
            <p style="margin:24px 0 0;color:#737780;font-size:12px">Если вы не запрашивали код, просто проигнорируйте письмо.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
    });
    return {};
  }
}

module.exports = { Mailer };
