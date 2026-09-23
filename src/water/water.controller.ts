import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { WaterMeterType } from "@prisma/client";
import {
  WaterService,
  parseMeterStatusParam,
  parseMeterTypeParam,
  parseVendingSystemParam,
} from "./water.service";
import { CreateAdjustmentDto } from "./dto/create-adjustment.dto";
import { CreateZoneDto } from "./dto/create-zone.dto";
import { UpdateZoneDto } from "./dto/update-zone.dto";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";
import { CreateMeterDto } from "./dto/create-meter.dto";
import { UpdateMeterDto } from "./dto/update-meter.dto";
import { CreateReadingDto } from "./dto/create-reading.dto";
import { UpdateReadingDto } from "./dto/update-reading.dto";
import { CreateUsageUploadDto } from "./dto/create-usage-upload.dto";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types/authenticated-user";
import { parsePaginationQuery } from "../common/pagination";

@Controller("water")
@Roles("water")
export class WaterController {
  constructor(private readonly waterService: WaterService) {}

  /* ---------- Zones (self-nesting) ---------- */

  @Get("zones")
  listZones(
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.waterService.listZones({ q }, parsePaginationQuery(page, pageSize));
  }

  @Get("zones/all")
  listAllZones() {
    return this.waterService.listAllZones();
  }

  @Get("zones/:id/detail")
  zoneDetail(@Param("id") id: string, @Query("month") month?: string) {
    return this.waterService.zoneDetail(id, month);
  }

  @Get("meters/unassigned")
  unassignedMeters(@Query("meterType") meterType?: WaterMeterType) {
    return this.waterService.unassignedMeters(meterType);
  }

  @Post("zones/:id/meters")
  assignMeters(@Param("id") id: string, @Body() body: { meterIds: string[] }) {
    return this.waterService.assignMetersToZone(id, body.meterIds ?? []);
  }

  @Post("meters/to-main-line")
  moveToMainLine(@Body() body: { meterIds: string[] }) {
    return this.waterService.assignMetersToZone(null, body.meterIds ?? []);
  }

  @Get("settled")
  settled(@Query("months") months?: string) {
    return this.waterService.settled({ months: months ? Number(months) : undefined });
  }

  @Get("adjustments")
  listAdjustments(
    @Query("zoneId") zoneId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.waterService.listAdjustments({
      zoneId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Post("adjustments")
  createAdjustment(@Body() dto: CreateAdjustmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.waterService.createAdjustment(dto, user.id);
  }

  @Delete("adjustments/:id")
  deleteAdjustment(@Param("id") id: string) {
    return this.waterService.deleteAdjustment(id);
  }

  @Get("zone-series")
  zoneSeries(
    @Query("granularity") granularity?: "week" | "month",
    @Query("periods") periods?: string,
  ) {
    return this.waterService.zoneSeries({
      granularity: granularity === "week" ? "week" : "month",
      periods: periods ? Number(periods) : undefined,
    });
  }

  @Get("meter-series")
  meterSeries(
    @Query("granularity") granularity?: "week" | "month",
    @Query("periods") periods?: string,
    @Query("meterType") meterType?: WaterMeterType,
  ) {
    return this.waterService.meterSeries({
      granularity: granularity === "week" ? "week" : "month",
      periods: periods ? Number(periods) : undefined,
      meterType,
    });
  }

  @Post("zones")
  createZone(@Body() dto: CreateZoneDto) {
    return this.waterService.createZone(dto);
  }

  @Patch("zones/:id")
  updateZone(@Param("id") id: string, @Body() dto: UpdateZoneDto) {
    return this.waterService.updateZone(id, dto);
  }

  @Delete("zones/:id")
  deleteZone(@Param("id") id: string) {
    return this.waterService.deleteZone(id);
  }

  /* ---------- Customers ---------- */

  @Get("customers")
  findAllCustomers(
    @Query("zoneId") zoneId?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.waterService.findAllCustomers({ zoneId, q }, parsePaginationQuery(page, pageSize));
  }

  @Get("customers/:id")
  getCustomerDetail(@Param("id") id: string, @Query("months") months?: string) {
    return this.waterService.getCustomerDetail(id, months ? Number(months) : undefined);
  }

  @Post("customers")
  createCustomer(@Body() dto: CreateCustomerDto) {
    return this.waterService.createCustomer(dto);
  }

  @Patch("customers/:id")
  updateCustomer(@Param("id") id: string, @Body() dto: UpdateCustomerDto) {
    return this.waterService.updateCustomer(id, dto);
  }

  @Delete("customers/:id")
  deleteCustomer(@Param("id") id: string) {
    return this.waterService.deleteCustomer(id);
  }

  /* ---------- Meters — the primary registration entry point ---------- */

  @Get("meters")
  findAllMeters(
    @Query("meterType") meterType?: string,
    @Query("zoneId") zoneId?: string,
    @Query("q") q?: string,
    @Query("vendingSystem") vendingSystem?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.waterService.findAllMeters(
      {
        meterType: parseMeterTypeParam(meterType),
        zoneId,
        q,
        vendingSystem: parseVendingSystemParam(vendingSystem),
        status: parseMeterStatusParam(status),
      },
      parsePaginationQuery(page, pageSize),
    );
  }

  @Get("meters/:id")
  getMeterDetail(@Param("id") id: string, @Query("months") months?: string) {
    return this.waterService.getMeterDetail(id, months ? Number(months) : undefined);
  }

  @Post("meters")
  createMeter(@Body() dto: CreateMeterDto) {
    return this.waterService.createMeter(dto);
  }

  @Patch("meters/:id")
  updateMeter(@Param("id") id: string, @Body() dto: UpdateMeterDto) {
    return this.waterService.updateMeter(id, dto);
  }

  @Delete("meters/:id")
  deleteMeter(@Param("id") id: string) {
    return this.waterService.deleteMeter(id);
  }

  /* ---------- Meter readings ---------- */

  @Get("readings")
  listReadings(
    @Query("meterId") meterId?: string,
    @Query("meterType") meterType?: string,
    @Query("zoneId") zoneId?: string,
    @Query("q") q?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.waterService.listReadings(
      { meterId, meterType: parseMeterTypeParam(meterType), zoneId, q, from, to },
      parsePaginationQuery(page, pageSize),
    );
  }

  @Post("readings")
  createReading(@Body() dto: CreateReadingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.waterService.createReading(dto, user);
  }

  @Patch("readings/:id")
  updateReading(@Param("id") id: string, @Body() dto: UpdateReadingDto) {
    return this.waterService.updateReading(id, dto);
  }

  @Delete("readings/:id")
  deleteReading(@Param("id") id: string) {
    return this.waterService.deleteReading(id);
  }

  /* ---------- Usage uploads & records ---------- */

  @Get("usage-uploads")
  listUploads(
    @CurrentUser() user: AuthenticatedUser,
    @Query("q") q?: string,
    @Query("month") month?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.waterService.listUploads(user, { q, month }, parsePaginationQuery(page, pageSize));
  }

  @Post("usage-uploads")
  createUpload(@Body() dto: CreateUsageUploadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.waterService.createUpload(dto, user);
  }

  // Deletes the upload together with the usage records it imported.
  @Delete("usage-uploads/:id")
  deleteUpload(@Param("id") id: string) {
    return this.waterService.deleteUpload(id);
  }

  @Get("usage-records")
  listUsageRecords(
    @Query("meterId") meterId?: string,
    @Query("customerId") customerId?: string,
    @Query("zoneId") zoneId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.waterService.listUsageRecords(
      { meterId, customerId, zoneId, dateFrom, dateTo },
      parsePaginationQuery(page, pageSize),
    );
  }

  /* ---------- Analytics ---------- */

  @Get("dashboard")
  dashboard(@Query("zoneId") zoneId?: string, @Query("month") month?: string) {
    return this.waterService.dashboard({ zoneId, month });
  }

  @Get("trend")
  trend(
    @Query("zoneId") zoneId?: string,
    @Query("months") months?: string,
    @Query("granularity") granularity?: "week" | "month",
    @Query("periods") periods?: string,
  ) {
    return this.waterService.trend({
      zoneId,
      months: months ? Number(months) : undefined,
      granularity: granularity === "week" ? "week" : "month",
      periods: periods ? Number(periods) : undefined,
    });
  }

  @Get("zone-comparison")
  zoneComparison(
    @Query("month") month?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) {
    return this.waterService.zoneComparison({
      month,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }

  @Get("reports/summary")
  reportSummary(@Query("month") month?: string) {
    return this.waterService.reportSummary({ month });
  }

  // Reading comparison series for the Reports page's period-filterable charts.
  @Get("readings/series")
  readingSeries(
    @Query("meterType") meterType: WaterMeterType,
    @Query("bucket") bucket: "day" | "week" | "month",
    @Query("dateFrom") dateFrom: string,
    @Query("dateTo") dateTo: string,
    @Query("zoneId") zoneId?: string,
  ) {
    return this.waterService.readingSeries({
      meterType,
      bucket,
      zoneId,
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
    });
  }

  // The reading log with each row's own computed delta.
  @Get("readings/with-delta")
  readingsWithDelta(
    @Query("meterId") meterId?: string,
    @Query("meterType") meterType?: WaterMeterType,
    @Query("zoneId") zoneId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) {
    return this.waterService.readingsWithDelta({
      meterId,
      meterType,
      zoneId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }
}
