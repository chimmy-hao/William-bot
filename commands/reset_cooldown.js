const { SlashCommandBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Conexión a Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// IDs de roles permitidos (Managers/Admins)
const ALLOWED_ROLES = ['1413313501694263357', '1412852141197885464'];

// MAPA DE CONFIGURACIÓN
// Aquí definimos qué columnas de la base de datos se deben poner a 0 para cada comando
const COMMAND_DB_MAP = {
  'photocard': { last_photocard_claim: 0 },
  'work':      { last_work_claim: 0 },
  'daily':     { last_daily_claim: 0 },
  'weekly':    { last_weekly_claim: 0 },
  // Alpha y Licuadora resetean tanto los usos como el tiempo
  'alpha':     { alpha_uses: 0, alpha_reset_time: 0 },      
  'licuadora': { licuadora_uses: 0, licuadora_reset_time: 0 } 
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset_cooldown')
    .setDescription('ADMIN: Resetea el tiempo de espera de un comando en la DB')
    .addStringOption(option =>
      option.setName('comando')
        .setDescription('El comando que quieres reiniciar')
        .setRequired(true)
        .addChoices(
          { name: '🎰 Drop (Photocard)', value: 'photocard' },
          { name: '💼 Work', value: 'work' },
          { name: '📅 Daily', value: 'daily' },
          { name: '🗓️ Weekly', value: 'weekly' },
          { name: '🐺 Project Alpha', value: 'alpha' },
          { name: '🌪️ Licuadora', value: 'licuadora' }
        )
    )
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Selecciona al usuario de la lista')
        .setRequired(true)
    )
    .addStringOption(option => 
      option.setName('razon')
        .setDescription('¿Por qué se realiza el reseteo?')
        .setRequired(false)
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

    // 3. Obtener qué columnas hay que limpiar
    const updateData = COMMAND_DB_MAP[commandName];

    if (!updateData) {
      return interaction.reply({ content: '❌ Error de configuración: El comando no está en la lista de reseteo.', ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // 4. Actualizar Supabase directamente
      // Esto pone las columnas correspondientes en 0 para ese usuario
      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('user_id', targetUser.id);

      if (error) {
        console.error('Error Supabase:', error);
        return interaction.editReply({ content: '❌ Ocurrió un error al intentar actualizar la base de datos.' });
      }

      // 5. Confirmación
      return interaction.editReply({
        content: `✅ **Cooldown Reseteado (Base de Datos)**\n\n👤 **Usuario:** ${targetUser}\n⚙️ **Comando:** \`/${commandName}\`\n📝 **Razón:** ${reason}`
      });

    } catch (error) {
      console.error('Error en reset_cooldown:', error);
      return interaction.editReply({ content: '❌ Ocurrió un error interno.', ephemeral: true });
    }
  }
};
