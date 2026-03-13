import notifier from "node-notifier";
import { loadConfig } from "../config/loader";
import { logger } from "../utils/logger";

export type NotificationType = "info" | "success" | "warning" | "error";

export const notify = (
	title: string,
	message: string,
	type: NotificationType = "info",
) => {
	try {
		const config = loadConfig();
		if (!config.behavior.notifications) {
			return;
		}

		const iconMap: Record<NotificationType, string> = {
			info: "dialog-information",
			success: "emblem-default",
			warning: "dialog-warning",
			error: "dialog-error",
		};

		notifier.notify({
			title: `Voice CLI: ${title}`,
			message,
			icon: iconMap[type],
			sound: type === "error",
			wait: false,
		});

		logger.debug({ title, message, type }, "Notification sent");
	} catch (error) {
		logger.error({ err: error }, "Failed to send notification");
	}
};
