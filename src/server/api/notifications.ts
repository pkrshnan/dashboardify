// NotificationService: when reminders go, and the browsers that get them. A browser's endpoint
// and keys go in and are never returned.

import type { Notifier } from "../../notifications/notifier";
import {
  type NotificationPrefs,
  type StoredSubscription,
  UnknownPushService,
} from "../../notifications/push-store";
import { currentDevice, currentOrigin } from "../request-context";
import { ApiError, failedPrecondition, invalidArgument } from "./errors";
import { requestedFields } from "./update-mask";

interface SettingsInput {
  name?: string;
  eventOffsetMinutes?: number[];
  taskReminders?: boolean;
}

interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  displayName?: string;
}

const PREFIX = "pushSubscriptions/";

export class NotificationsService {
  constructor(private readonly notifier: Notifier) {}

  private get store() {
    return this.notifier.store;
  }

  getNotificationSettings = async () => this.settingsView(this.store.prefs());

  updateNotificationSettings = async (request: {
    notificationSettings: SettingsInput;
    updateMask?: string;
  }) => {
    const input = request.notificationSettings;
    if (input.name && input.name !== "notificationSettings") {
      invalidArgument("notification_settings.name must be notificationSettings");
    }
    const fields = requestedFields(request, input, ["eventOffsetMinutes", "taskReminders"]);
    const next = { ...this.store.prefs() };
    if (fields.includes("eventOffsetMinutes")) {
      next.eventOffsets = input.eventOffsetMinutes ?? [];
    }
    if (fields.includes("taskReminders")) {
      next.taskReminders = input.taskReminders ?? false;
    }
    return this.settingsView(this.store.setPrefs(next));
  };

  createPushSubscription = async (request: { pushSubscription: SubscriptionInput }) => {
    const device = currentDevice();
    if (!device || device === "setup") {
      failedPrecondition("Sign in on this device before turning notifications on.");
    }
    const input = request.pushSubscription;
    try {
      const stored = this.store.subscribe(device, {
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        displayName: input.displayName?.trim() || "Browser",
        subject: currentOrigin() ?? "",
      });
      return subscriptionView(stored);
    } catch (error) {
      if (error instanceof UnknownPushService) {
        invalidArgument(error.message);
      }
      throw error;
    }
  };

  listPushSubscriptions = async () => ({
    pushSubscriptions: this.store.list().map(subscriptionView),
  });

  deletePushSubscription = async (request: { name: string }) => {
    if (!this.store.remove(request.name.slice(PREFIX.length))) {
      throw new ApiError(404, "push subscription not found");
    }
    return {};
  };

  testNotification = async () => {
    const targets = this.store.targets(currentDevice());
    if (targets.length === 0) {
      failedPrecondition("Turn notifications on for this device first.");
    }
    return this.notifier.push(
      targets,
      {
        title: "Notifications work",
        body: "Reminders will appear like this.",
        tag: "test",
        url: "/#/",
      },
      { ttl: 60, urgency: "high" },
    );
  };

  private settingsView(prefs: NotificationPrefs) {
    return {
      name: "notificationSettings",
      eventOffsetMinutes: prefs.eventOffsets,
      taskReminders: prefs.taskReminders,
      publicKey: this.store.keys().publicKey,
    };
  }
}

function subscriptionView(subscription: StoredSubscription) {
  return {
    name: `${PREFIX}${subscription.id}`,
    displayName: subscription.displayName,
    device: subscription.device,
    createTime: subscription.createTime,
  };
}
