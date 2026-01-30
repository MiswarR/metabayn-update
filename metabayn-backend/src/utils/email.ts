import { Env } from '../types';

export async function sendEmail(to: string, subject: string, html: string, env: Env) {
  if (!env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is missing. Skipping email.");
    // If strict mode is required, we should throw here, but for dev we might skip
    throw new Error("Email service not configured (RESEND_API_KEY missing)");
  }

  try {
    const from = env.EMAIL_FROM && env.EMAIL_FROM.includes('<')
      ? env.EMAIL_FROM
      : `Metabayn Studio <${env.EMAIL_FROM || 'admin@albayn.site'}>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: from,
        reply_to: 'no-reply@albayn.site',
        to: [to],
        subject: subject,
        html: html
      })
    });

    if (!res.ok) {
        const error = await res.text();
        console.error("Resend API Error:", error);
        throw new Error(`Email delivery failed: ${error}`);
    }
  } catch (e: any) {
    console.error("Failed to send email:", e);
    throw new Error(e.message || "Failed to send email");
  }
}

export function getTopupSuccessTemplate(amount: number, tokensAdded: number, currency: 'IDR' | 'USD' = 'IDR') {
    const formattedAmount = currency === 'IDR' 
        ? `Rp ${amount.toLocaleString('id-ID')}`
        : `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    return `
    <div style="font-family: sans-serif; padding: 20px;">
        <h2>Top-Up Token Successful</h2>
        <p>Hello,</p>
        <p>We have received your payment of <strong>${formattedAmount}</strong>.</p>
        <ul>
            <li>Tokens Added: <strong>${tokensAdded.toLocaleString()} Tokens</strong></li>
        </ul>
        <p>Your balance has been updated. Happy creating!</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">
            This is an automated message, please do not reply.<br>
            For support, join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
        </p>
    </div>
    `;
}

export function getManualApproveTemplate(name: string, amount: number, tokensAdded: number, currency: 'IDR' | 'USD' = 'IDR') {
    const formattedAmount = currency === 'IDR' 
        ? `Rp ${amount.toLocaleString('id-ID')}`
        : `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    return `
    <div style="font-family: sans-serif; padding: 20px;">
        <h2>Top-Up Successful (Manual Approval)</h2>
        <p>Hello ${name},</p>
        <p>Your transaction of <strong>${formattedAmount}</strong> has been manually confirmed by admin.</p>
        <p>Tokens added to your account: <strong>${tokensAdded.toLocaleString()}</strong></p>
        <p>Thank you for your patience!</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">
            This is an automated message, please do not reply.<br>
            For support, join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
        </p>
    </div>
    `;
}

export function getVerificationTemplate(email: string, pass: string, confirmLink: string) {
    return `
    <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
             <h2 style="color: #333;">Welcome to Metabayn Studio!</h2>
        </div>
        <p>Hello,</p>
        <p>Thank you for registering. To activate your account, please click the button below:</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="${confirmLink}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">Verify Email Address</a>
        </div>

        <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
        <p style="font-size: 12px; color: #666; word-break: break-all;">${confirmLink}</p>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">

        <p><strong>Your Account Credentials:</strong></p>
        <ul style="background: #f9f9f9; padding: 15px; border-radius: 4px; list-style: none;">
            <li style="margin-bottom: 8px;"><strong>Email:</strong> ${email}</li>
            <li><strong>Password:</strong> ${pass}</li>
        </ul>
        <p style="color: #d32f2f; font-size: 12px;">*Please keep this information safe. Do not share your password with anyone.</p>

        <br>
        <p>Best regards,</p>
        <p>Metabayn Studio Team</p>

        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">
            This is an automated message, please do not reply to this email.<br>
            For support and updates, please join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
        </p>
    </div>
    `;
}

export function getWelcomeTemplate(email: string) {
    return `
    <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
             <h2 style="color: #333;">Verification Successful!</h2>
        </div>
        <p>Hello,</p>
        <p>Congratulations! Your email has been verified and your account is now active.</p>
        <p>You can now login to the Metabayn Studio application.</p>

        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">

        <p><strong>Join Our Community</strong></p>
        <p>Connect with other users, get updates, and share your experience in our WhatsApp Group:</p>
        
        <div style="text-align: center; margin: 20px 0;">
            <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="background-color: #25D366; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">Join WhatsApp Group</a>
        </div>
        
        <br>
        <p>Best regards,</p>
        <p>Metabayn Studio Team</p>

        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">
            This is an automated message, please do not reply to this email.<br>
            For support and updates, please join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
        </p>
    </div>
    `;
}

export function getRegistrationTemplate(email: string, pass: string, confirmLink: string) {
    // DEPRECATED: Kept for backward compatibility if needed, but redirects to verification template
    return getVerificationTemplate(email, pass, confirmLink);
}

export function getGoogleWelcomeTemplate(email: string, pass: string) {
    return `
    <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
             <h2 style="color: #333;">Welcome to Metabayn Studio!</h2>
        </div>
        <p>Hello,</p>
        <p>Thank you for logging in with Google. Your account is now active.</p>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">

        <p><strong>Your Account Credentials:</strong></p>
        <p>We have generated a password for you if you wish to login manually later:</p>
        <ul style="background: #f9f9f9; padding: 15px; border-radius: 4px; list-style: none;">
            <li style="margin-bottom: 8px;"><strong>Email:</strong> ${email}</li>
            <li><strong>Password:</strong> ${pass}</li>
        </ul>
        <p style="color: #d32f2f; font-size: 12px;">*Please keep this information safe. Do not share your password with anyone.</p>
        
        <br>
        <p>Best regards,</p>
        <p>Metabayn Studio Team</p>
    </div>
    `;
}

export function getPurchaseVoucherTemplate(email: string, voucherCode: string, type: 'token' | 'subscription', value: number) {
  const title = type === 'subscription' 
      ? `${value} Days Subscription Voucher` 
      : `${value.toLocaleString()} Tokens Voucher`;

  const description = type === 'subscription'
      ? `You have successfully purchased a <strong>${value} Days Subscription</strong>.`
      : `You have successfully purchased <strong>${value.toLocaleString()} Tokens</strong>.`;

  return `
  <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 20px;">
           <h2 style="color: #333;">Payment Successful</h2>
      </div>
  
      <p>Hi ${email},</p>
      <p>
        Thank you for your purchase. We have received your payment from Lynk.id.
        ${description}
      </p>
  
      <h3>Your Voucher Code</h3>
      <div style="background: #f5f5f5; padding: 12px 16px; border-radius: 4px; text-align: center; margin: 10px 0 20px 0;">
        <span style="font-size: 20px; letter-spacing: 3px; font-weight: bold; color: #222;">
          ${voucherCode}
        </span>
      </div>
  
      <p style="color: #d32f2f; font-size: 12px; margin-top: -8px;">
        * This voucher is valid for one-time use only.
      </p>
  
      <h3>How to Redeem</h3>
      <ol>
        <li>Open <strong>Metabayn Studio</strong> app.</li>
        <li>Go to <strong>Voucher / Redeem</strong> menu.</li>
        <li>Enter the code above and click Redeem.</li>
      </ol>
  
      <br>
      <p>Best regards,</p>
      <p><strong>Metabayn Studio Team</strong></p>
  
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #888; text-align: center;">
        This is an automated message, please do not reply.<br>
        For support, join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
      </p>
  </div>
  `;
}

export function getWelcomeVoucherTemplate(email: string, voucherCode: string, amountTokens: number) {
    return `
    <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
             <h2 style="color: #333;">Thank You for Purchasing Metabayn Studio</h2>
        </div>

        <p>Hi ${email},</p>
        <p>
          Thank you for purchasing <strong>Metabayn Studio</strong>.
          As a welcome bonus, you receive free credits worth <strong>$3</strong> that you can use inside the app.
        </p>

        <h3>Your One-Time Voucher Code</h3>
        <div style="background: #f5f5f5; padding: 12px 16px; border-radius: 4px; text-align: center; margin: 10px 0 20px 0;">
          <span style="font-size: 20px; letter-spacing: 3px; font-weight: bold; color: #222;">
            ${voucherCode}
          </span>
        </div>

        <p style="color: #d32f2f; font-size: 12px; margin-top: -8px;">
          * This voucher can only be used once. Please keep it private and do not share it with others.
        </p>

        <h3>How to Use Your Voucher</h3>
        <ol>
          <li>Download and install the Metabayn Studio application.</li>
          <li>Open the app and create a new account (Register).</li>
          <li>Verify your email address by clicking the verification link sent to your inbox.</li>
          <li>After login, open the <strong>Voucher / Redeem</strong> menu inside the app.</li>
          <li>Enter the voucher code above and confirm.</li>
        </ol>

        <p>
          Once redeemed, your token balance will be updated automatically and you can start using Metabayn Studio right away.
        </p>

        <br>
        <p>Best regards,</p>
        <p><strong>Metabayn Studio Team</strong></p>

        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">
          This is an automated message, please do not reply to this email.<br>
          For support and updates, please join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
        </p>
    </div>
    `;
}

export function getWelcomeDualVoucherTemplate(email: string, tokenCode: string, amountTokens: number, subscriptionCode: string, durationDays: number) {
  return `
  <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 20px;">
           <h2 style="color: #333;">Thank You for Purchasing Metabayn Studio</h2>
      </div>

      <p>Hi ${email},</p>
      <p>
        As a welcome bonus, you receive <strong>$3</strong> worth of tokens and a <strong>${durationDays} Days API Key Subscription</strong>.
      </p>

      <h3>Your Token Voucher Code</h3>
      <div style="background: #f5f5f5; padding: 12px 16px; border-radius: 4px; text-align: center; margin: 10px 0 20px 0;">
        <span style="font-size: 20px; letter-spacing: 3px; font-weight: bold; color: #222;">
          ${tokenCode}
        </span>
      </div>
      <p>You will receive <strong>${amountTokens.toLocaleString()} Tokens</strong> after redeeming this voucher.</p>

      <h3>Your Subscription Voucher Code</h3>
      <div style="background: #f5f5f5; padding: 12px 16px; border-radius: 4px; text-align: center; margin: 10px 0 20px 0;">
        <span style="font-size: 20px; letter-spacing: 3px; font-weight: bold; color: #222;">
          ${subscriptionCode}
        </span>
      </div>
      <p>Redeem this voucher to activate <strong>${durationDays} Days</strong> of API Key mode subscription.</p>

      <p style="color: #d32f2f; font-size: 12px; margin-top: -8px;">
        * Each voucher is valid for one-time use only.
      </p>

      <h3>How to Redeem</h3>
      <ol>
        <li>Open <strong>Metabayn Studio</strong> app.</li>
        <li>Go to <strong>Voucher / Redeem</strong> menu.</li>
        <li>Enter the code above and click Redeem.</li>
      </ol>

      <br>
      <p>Best regards,</p>
      <p><strong>Metabayn Studio Team</strong></p>

      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #888; text-align: center;">
        This is an automated message, please do not reply.<br>
        For support, join our <a href="https://chat.whatsapp.com/JD1KDEjKPV3Fp6fJMRz6qS" style="color: #25D366; text-decoration: none;">WhatsApp Community</a>.
      </p>
  </div>
  `;
}
