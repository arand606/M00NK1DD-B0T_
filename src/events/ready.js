import { Events } from "discord.js";
import { logger, startupLog } from "../utils/logger.js";
import config from "../config/application.js";
import { reconcileReactionRoleMessages } from "../services/reactionRoleService.js";

export default {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      client.user.setPresence(config.bot.presence);

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


// Ensure BotConfig or botConfig is imported at the top of your ready file if it isn't already:
// import botConfig from '../../config/bot.js'; 

// INSIDE your client 'ready' event block/execute function:
const { activities, status, cycleInterval } = botConfig.presence;

if (activities && activities.length > 0) {
    let currentIndex = 0;

    // Set initial presence immediately when the bot boots up
    client.user.setPresence({
        activities: [activities[currentIndex]],
        status: status
    });

    // Fire the automatic loop
    setInterval(() => {
        currentIndex = (currentIndex + 1) % activities.length; // Wraps around automatically
        
        client.user.setPresence({
            activities: [activities[currentIndex]],
            status: status
        });
    }, cycleInterval || 20000);
}



