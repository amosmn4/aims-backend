import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Kenyan numbers (0712…, 712…, 254712…) become +254…; other countries need their code. */
export function toInternational(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  if (/^\+\d{9,15}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`;
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}

export interface SmsResult {
  sent: boolean;
  reason?: string;
}

const SMS_LIMIT = 160;

/** Keeps an alert to one SMS so each costs a single message. */
export function toSingleSms(message: string) {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length <= SMS_LIMIT ? clean : `${clean.slice(0, SMS_LIMIT - 1).trimEnd()}…`;
}

const SMS_STATUS_REASON: Record<string, string> = {
  InvalidPhoneNumber: "Africa's Talking says the phone number isn't valid",
  InsufficientBalance: "The Africa's Talking account is out of credit",
  InvalidSenderId: "The sender ID isn't approved for this account",
  UserInBlacklist: "This number has opted out of SMS from this sender",
  UnsupportedNumberType: "This number can't receive SMS from this sender",
  CouldNotRoute: "Africa's Talking couldn't deliver to this network",
  RiskHold: "Africa's Talking is holding the message for a risk check",
};

function parseRecipient(body: string): { statusCode: number; status: string } | null {
  try {
    const data = JSON.parse(body) as {
      SMSMessageData?: { Recipients?: { statusCode?: number; status?: string }[] };
    };
    const r = data.SMSMessageData?.Recipients?.[0];
    return r ? { statusCode: Number(r.statusCode), status: String(r.status ?? "") } : null;
  } catch {
    return null;
  }
}

const maskNumber = (n: string) => `${n.slice(0, 5)}•••${n.slice(-3)}`;

// SMS through Africa's Talking and WhatsApp through the Cloud API; each is skipped when not configured.
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(private readonly config: ConfigService) {}

  smsConfigured() {
    return !!(this.config.get<string>("AT_USERNAME") && this.config.get<string>("AT_API_KEY"));
  }

  whatsappConfigured() {
    return !!(
      this.config.get<string>("WHATSAPP_TOKEN") &&
      this.config.get<string>("WHATSAPP_PHONE_NUMBER_ID")
    );
  }

  /** Sends one SMS through Africa's Talking; true only when the number was accepted. */
  async sendSms(phone: string, message: string): Promise<boolean> {
    return (await this.sendSmsDetailed(phone, message)).sent;
  }

  async sendSmsDetailed(phone: string, message: string): Promise<SmsResult> {
    if (!this.smsConfigured()) return { sent: false, reason: "SMS isn't set up on the server yet" };
    const to = toInternational(phone);
    if (!to) return { sent: false, reason: "The phone number isn't in a format SMS can use" };
    const username = this.config.get<string>("AT_USERNAME")!;
    const host =
      username === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
    const form = new URLSearchParams({ username, to, message: toSingleSms(message) });
    const senderId = this.config.get<string>("AT_SENDER_ID");
    if (senderId) form.set("from", senderId);
    try {
      const res = await fetch(`https://${host}/version1/messaging`, {
        method: "POST",
        body: form.toString(),
        headers: {
          apiKey: this.config.get<string>("AT_API_KEY")!,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(`Africa's Talking replied ${res.status}: ${text.slice(0, 200)}`);
        return {
          sent: false,
          reason: "The SMS provider refused the request. Check the username and API key.",
        };
      }
      const recipient = parseRecipient(text);
      // 100 Processed, 101 Sent and 102 Queued are accepted; anything else failed.
      if (recipient && [100, 101, 102].includes(recipient.statusCode)) return { sent: true };
      const status = recipient?.status ?? "Unknown";
      this.logger.warn(`SMS to ${maskNumber(to)} not sent: ${status}`);
      return {
        sent: false,
        reason: SMS_STATUS_REASON[status] ?? `The SMS provider said: ${status}`,
      };
    } catch (err) {
      this.logger.warn(`SMS send failed: ${err instanceof Error ? err.message : err}`);
      return { sent: false, reason: "Couldn't reach the SMS provider. Try again later." };
    }
  }

  async sendWhatsApp(phone: string, message: string): Promise<boolean> {
    const to = toInternational(phone);
    if (!this.whatsappConfigured() || !to) return false;
    const template = this.config.get<string>("WHATSAPP_TEMPLATE_NAME");
    // Business-started WhatsApp messages need an approved template with one text variable.
    const payload = template
      ? {
          messaging_product: "whatsapp",
          to: to.slice(1),
          type: "template",
          template: {
            name: template,
            language: { code: this.config.get<string>("WHATSAPP_TEMPLATE_LANGUAGE") ?? "en" },
            components: [
              { type: "body", parameters: [{ type: "text", text: message.slice(0, 1000) }] },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to: to.slice(1),
          type: "text",
          text: { body: message.slice(0, 4000) },
        };
    const phoneId = this.config.get<string>("WHATSAPP_PHONE_NUMBER_ID")!;
    return this.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      JSON.stringify(payload),
      {
        Authorization: `Bearer ${this.config.get<string>("WHATSAPP_TOKEN")}`,
        "Content-Type": "application/json",
      },
    );
  }

  private async post(url: string, body: string, headers: Record<string, string>) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body,
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.logger.warn(`Message provider replied ${res.status}`);
      return res.ok;
    } catch (err) {
      this.logger.warn(`Message send failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
