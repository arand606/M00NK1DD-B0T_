import botConfig from '../config/bot.js';
import { Events } from "discord.js";
import { logger, startupLog } from "../utils/logger.js";
import config from "../config/application.js";
import { reconcileReactionRoleMessages } from "../services/reactionRoleService.js";

export default {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      const { activities, status, cycleInterval } = botConfig.presence;

      // Set initial status
      if (activities && activities.length > 0) {
        let currentIndex = 0;

        // Set the initial status right away
        client.user.setPresence({
          activities: [activities[currentIndex]],
          status: status
        });

        // Cycle through statuses
        setInterval(() => {
          currentIndex = (currentIndex + 1) % activities.length;
          
          client.user.setPresence({
            activities: [activities[currentIndex]],
            status: status
          });
        }, cycleInterval || 17000);
      } else {
        // Fallback if no activities configured
        client.user.setPresence(config.bot.presence);
      }

      startupLog(`Ready! Logged in as ${client.user.tag}`);
      startupLog(`Serving ${client.guilds.cache.size} guild(s)`);
      startupLog(`Loaded ${client.commands.size} commands`);

      const reconciliationSummary = await reconcileReactionRoleMessages(client);
      startupLog(
        `Reaction role reconciliation: scanned ${reconciliationSummary.scannedMessages}, removed ${reconciliationSummary.removedMessages}, errors ${reconciliationSummary.errors}`
      );
    } catch (error) {
      logger.error("Error in ready event:", error);
    }
  },
};
