// DeviceService: add, list and revoke devices. A new device's token is in the CreateDevice
// response only; it is never stored, so no later call can return it.

import type { Device, DeviceStore } from "../../settings/devices";
import { currentDevice } from "../request-context";
import { ApiError } from "./errors";

/** A retried CreateDevice with the same request id gets the same answer for this long. */
const RETRY_WINDOW_MS = 10 * 60_000;

type DeviceView = ReturnType<typeof view>;

export class DevicesService {
  private readonly recent = new Map<string, { at: number; device: DeviceView }>();

  constructor(
    private readonly devices: DeviceStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createDevice = async (request: { device: { displayName: string }; requestId?: string }) => {
    this.forgetOld();
    const retried = request.requestId ? this.recent.get(request.requestId) : undefined;
    if (retried) {
      return retried.device;
    }
    const { device, token } = this.devices.add(request.device.displayName);
    const created = { ...view(device), token };
    if (request.requestId) {
      this.recent.set(request.requestId, { at: this.now().getTime(), device: created });
    }
    return created;
  };

  listDevices = async () => ({ devices: this.devices.list().map(view) });

  deleteDevice = async (request: { name: string }) => {
    const id = request.name.startsWith("devices/") ? request.name.slice("devices/".length) : "";
    if (!(id && this.devices.revoke(id))) {
      throw new ApiError(404, "device not found");
    }
    return {};
  };

  private forgetOld(): void {
    const cutoff = this.now().getTime() - RETRY_WINDOW_MS;
    for (const [key, entry] of this.recent) {
      if (entry.at < cutoff) {
        this.recent.delete(key);
      }
    }
  }
}

function view(device: Device) {
  return {
    name: `devices/${device.id}`,
    displayName: device.displayName,
    createTime: device.createTime,
    ...(device.lastUsedTime && { lastUsedTime: device.lastUsedTime }),
    current: currentDevice() === device.id,
  };
}
