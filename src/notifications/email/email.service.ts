import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";

// SMTP is optional — the app boots fine without it, and the digest job simply logs a warning
// and sends nothing instead of throwing, matching the GoogleAnalyticsService/StorageService
// degrade pattern used elsewhere in this app.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null = null;
  private readonly from: string | null = null;

  constructor(config: ConfigService) {
    const host = config.get<string>("SMTP_HOST");
    const port = config.get<number>("SMTP_PORT");
    const user = config.get<string>("SMTP_USER");
    const password = config.get<string>("SMTP_PASSWORD");
    const from = config.get<string>("SMTP_FROM");
    if (!host || !port || !user || !password || !from) {
      this.logger.warn("SMTP is not configured — email digests will not be sent");
      return;
    }
    this.from = from;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass: password },
    });
  }

  isConfigured(): boolean {
    return !!this.transporter;
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.transporter || !this.from) return false;
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      return true;
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}`, err instanceof Error ? err.stack : undefined);
      return false;
    }
  }
}
