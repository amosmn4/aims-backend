import { IsIn } from "class-validator";
import { TICKET_STATUSES } from "./create-ticket.dto";

export class UpdateTicketStatusDto {
  @IsIn(TICKET_STATUSES)
  status!: (typeof TICKET_STATUSES)[number];
}
