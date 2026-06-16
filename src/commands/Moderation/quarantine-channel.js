import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName("quarantine-channel")
    .setDescription("Quarantine a channel - restricts access to the channel")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The channel to quarantine")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for quarantine"),
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
      const reason = interaction.options.getString("reason") || "Channel quarantined";

      // Validation checks
      if (!targetChannel) {
        throw new TitanBotError(
          "Channel not found",
          ErrorTypes.USER_INPUT,
          "The specified channel could not be found.",
          { subtype: 'channel_not_found' }
        );
      }

      // Don't allow quarantining DM or Thread channels
      if (targetChannel.isDMBased() || targetChannel.isThread()) {
        throw new TitanBotError(
          "Invalid channel",
          ErrorTypes.USER_INPUT,
          "You cannot quarantine DM or thread channels."
        );
      }

      await interaction.deferReply();

      const guild = interaction.guild;
      const everyone = guild.roles.everyone;
      
      // Get current permissions for @everyone role
      let currentOverwrite = targetChannel.permissionOverwrites.get(everyone.id);

      // Deny send messages permission for @everyone
      await targetChannel.permissionOverwrites.edit(
        everyone.id,
        {
          SendMessages: false,
          SendMessagesInThreads: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false
        },
        `Quarantine Channel: ${reason}`
      );

      // Log the moderation action
      const caseId = await logModerationAction({
        client,
        guild: interaction.guild,
        event: {
          action: "Channel Quarantined",
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
      const description = `**Channel:** ${targetChannel}\n**Reason:** ${reason}\n**Case ID:** #${caseId}\n\n⚠️ Channel access has been restricted. Members cannot send messages.`;

      await InteractionHelper.universalReply(interaction, {
        embeds: [
          successEmbed(
            `🔒 **Quarantined** #${targetChannel.name}`,
            description,
          ),
        ],
      });

      logger.info(`Channel #${targetChannel.name} quarantined in ${guild.name} by ${interaction.user.tag}`);
    } catch (error) {
      logger.error('Quarantine channel command error:', error);
      const errorEmbed_default = errorEmbed(
        "An unexpected error occurred while trying to quarantine the channel.",
        error.message || "Could not quarantine the channel"
      );
      await InteractionHelper.universalReply(interaction, { embeds: [errorEmbed_default] });
    }
  }
};