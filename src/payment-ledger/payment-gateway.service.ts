import {
  BadGatewayException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class PaymentGatewayService {
  constructor(private readonly config: ConfigService) {}

  get configured() {
    return (
      !!this.config.get<string>("PAYMENT_GATEWAY_URL") &&
      !!this.config.get<string>("PAYMENT_GATEWAY_BRIDGE_KEY")
    );
  }

  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const base = this.config.get<string>("PAYMENT_GATEWAY_URL");
    const key = this.config.get<string>("PAYMENT_GATEWAY_BRIDGE_KEY");
    if (!base || !key)
      throw new ServiceUnavailableException("The payment gateway is not connected.");
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !(local && this.config.get("NODE_ENV") !== "production"))
    ) {
      throw new ServiceUnavailableException("The payment gateway requires HTTPS.");
    }
    let response: Response;
    try {
      response = await fetch(`${base.replace(/\/$/, "")}/aims/${path}`, {
        method,
        headers: {
          Authorization: `Aims-Key ${key}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
    } catch {
      throw new BadGatewayException("The payment gateway could not be reached. Please retry.");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const details = Object.entries(data)
        .map(
          ([field, value]) =>
            `${field}: ${Array.isArray(value) ? value.join(", ") : String(value)}`,
        )
        .join("; ");
      throw new HttpException(
        { message: details || "The payment gateway rejected the request." },
        [400, 404, 409].includes(response.status) ? response.status : 502,
      );
    }
    return response.json() as Promise<T>;
  }
}
