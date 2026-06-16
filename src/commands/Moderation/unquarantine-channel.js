import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName("unquarantine-channel")
    .setDescription("Remove quarantine from a channel - restores access to the channel")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The channel to unquarantine")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for removing quarantine"),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  category: "moderation",

  async execute(interaction, config, client) {
    try {
      // Permission check
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        throw new TitanBotError(
          "User lacks permission",
          ErrorTypes.PERMISSION,
          "You do not have permission to manage channels."
        );
      }

      const targetChannel = interaction.options.getChannel("channel");
      const reason = interaction.options.getString("reason") || "Quarantine lifted";

      // Validation checks
      if (!targetChannel) {
        throw new TitanBotError(
          "Channel not found",
          ErrorTypes.USER_INPUT,
          "The specified channel could not be found.",
          { subtype: 'channel_not_found' }
        );
      }

      // Don't allow unquarantining DM or Thread channels
      if (targetChannel.isDMBased() || targetChannel.isThread()) {
        throw new TitanBotError(
          "Invalid channel",
          ErrorTypes.USER_INPUT,
          "You cannot unquarantine DM or thread channels."
        );
      }

      await interaction.deferReply();

      const guild = interaction.guild;
      const everyone = guild.roles.everyone;
      
      // Check if there's a deny permission for @everyone
      const memberPermissions = targetChannel.permissionOverwrites.get(everyone.id);
      
      if (!memberPermissions) {
        throw new TitanBotError(
          "Not quarantined",
          ErrorTypes.USER_INPUT,
          "This channel does not appear to be quarantined."
        );
      }

      // Remove the permission override for @everyone
      await targetChannel.permissionOverwrites.delete(everyone.id, `Unquarantine: ${reason}`);

      // Log the moderation action
      const caseId = await logModerationAction({
        client,
        guild: interaction.guild,
        event: {
          action: "Channel Unquarantined",
          target: `#${targetChannel.name} (${targetChannel.id})`,
          executor: `${interaction.user.tag} (${interaction.user.id})`,
          reason,
          metadata: {
            channelId: targetChannel.id,
            channelName: targetChannel.name,
            moderatorId: interaction.user.id
          }
        }
      });

      // Prepare response message
      const description = `**Channel:** ${targetChannel}\n**Reason:** ${reason}\n**Case ID:** #${caseId}\n\n✅ Channel access has been restored.`;

      await InteractionHelper.universalReply(interaction, {
        embeds: [
          successEmbed(
            `🔓 **Unquarantined** #${targetChannel.name}`,
            description,
          ),
        ],
      });

      logger.info(`Channel #${targetChannel.name} unquarantined in ${guild.name} by ${interaction.user.tag}`);
    } catch (error) {
      logger.error('Unquarantine channel command error:', error);
      const errorEmbed_default = errorEmbed(
        "An unexpected error occurred while trying to unquarantine the channel.",
        error.message || "Could not unquarantine the channel"
      );
      await InteractionHelper.universalReply(interaction, { embeds: [errorEmbed_default] });
    }
  }
};
