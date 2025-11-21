const { SlashCommandBuilder } = require('discord.js');

// IDs de roles permitidos (Managers/Admins)
const ALLOWED_ROLES = ['1413313501694263357', '1412852141197885464'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset_cooldown')
    .setDescription('ADMIN: Resetea el tiempo de espera de un comando')
    .addStringOption(option =>
      option.setName('comando')
        .setDescription('El comando que quieres reiniciar')
        .setRequired(true)
        .addChoices(
          { name: '🎰 Drop (Photocard)', value: 'photocard' }, // Apunta al archivo photocard.js
          { name: '💼 Work', value: 'work' },
          { name: '📅 Daily', value: 'daily' }
          // { name: '🗓️ Weekly', value: 'weekly' } // Descomentar cuando lo crees
        )
    )
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Selecciona al usuario de la lista')
        .setRequired(true) // Obligatorio elegir a alguien
    )
    .addStringOption(option => 
      option.setName('razon')
        .setDescription('¿Por qué se realiza el reseteo?')
        .setRequired(false) // Opcional
    ),

  async execute(interaction) {
    // 1. Verificar Permisos (Roles)
    const memberRoles = interaction.member.roles.cache;
    const hasPermission = ALLOWED_ROLES.some(roleId => memberRoles.has(roleId));

    if (!hasPermission) {
      return interaction.reply({ 
        content: '🚫 **Acceso Denegado:** No tienes permisos de administrador para usar este comando.', 
        ephemeral: true 
      });
    }

    // 2. Obtener datos
    const targetUser = interaction.options.getUser('usuario');
    const commandName = interaction.options.getString('comando');
    const reason = interaction.options.getString('razon') || 'Sin razón especificada';

    try {
      // 3. Cargar el archivo del comando dinámicamente
      let commandModule;
      try {
        commandModule = require(`./${commandName}.js`);
      } catch (e) {
        return interaction.reply({ content: `❌ No pude encontrar el archivo de comando \`${commandName}.js\`.`, ephemeral: true });
      }

      // 4. Verificar si el comando expone sus cooldowns
      if (!commandModule.cooldowns) {
        return interaction.reply({ 
          content: `⚠️ El comando \`${commandName}\` no permite resetear su tiempo (Falta exportar 'cooldowns').`, 
          ephemeral: true 
        });
      }

      // 5. Ejecutar el reseteo
      if (commandModule.cooldowns.has(targetUser.id)) {
        commandModule.cooldowns.delete(targetUser.id);
        
        return interaction.reply({
          content: `✅ **Cooldown Reseteado**\n\n👤 **Usuario:** ${targetUser}\nwd **Comando:** \`/${commandName}\`\n📝 **Razón:** ${reason}`
        });
      } else {
        return interaction.reply({
          content: `ℹ️ **${targetUser.username}** no tenía ningún cooldown activo en \`/${commandName}\`.`,
          ephemeral: true
        });
      }

    } catch (error) {
      console.error('Error en reset_cooldown:', error);
      return interaction.reply({ content: '❌ Ocurrió un error interno al intentar resetear.', ephemeral: true });
    }
  }
};
