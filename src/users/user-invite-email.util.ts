function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderInviteEmail(name: string, link: string): string {
  return `<p>Hi ${escapeHtml(name)},</p>
<p>An account has been created for you in AIMS. Click the link below to verify your email and set your password:</p>
<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p>This link expires in 72 hours. If you weren't expecting this, you can ignore this email.</p>`;
}
