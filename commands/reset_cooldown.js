const { SlashCommandBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Conexión a Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// IDs de roles permitidos (Managers/Admins)
const ALLOWED_ROLES = ['1413313501694263357', '1412852141197885464'];

// MAPA DE CONFIGURACIÓN
// Actualizado para incluir world_tour (reset de last_checkin)
const COMMAND_DB_MAP = {
  'photocard':  { last_photocard_claim: 0, photocard_notified: false },
  'work':       { last_work_claim: 0, work_notified: false },
  'daily':      { last_daily_claim: 0, daily_notified: false },
  'weekly':     { last_weekly_claim: 0, weekly_notified: false },
  'alpha':      { alpha_uses: 0, alpha_reset_time: 0, alpha_notified: false },      
  'licuadora':  { licuadora_uses: 0, licuadora_reset_time: 0, licuadora_notified: false },
  'world_tour': { last_checkin: 0 } // Nuevo: Resetea el tiempo de espera del concierto
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
          { name: '🌪️ Licuadora', value: 'licuadora' },
          { name: '🌍 World Tour', value: 'world_tour' } // Opción agregada
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
    // 1. AVISO INMEDIATO
    await interaction.deferReply(); 

    try {
      // 2. Verificar Permisos (Roles)
      const memberRoles = interaction.member.roles.cache;
      const hasPermission = ALLOWED_ROLES.some(roleId => memberRoles.has(roleId));

      if (!hasPermission) {
        return interaction.editReply({ 
          content: '🚫 **Acceso Denegado:** No tienes permisos de administrador para usar este comando.'
        });
      }

      // 3. Obtener datos
      const targetUser = interaction.options.getUser('usuario');
      const commandName = interaction.options.getString('comando');
      const reason = interaction.options.getString('razon') || 'Sin razón especificada';

      // 4. Obtener configuración
      const updateData = COMMAND_DB_MAP[commandName];

      if (!updateData) {
        return interaction.editReply({ content: '❌ Error de configuración: El comando no está en la lista de reseteo.' });
      }

      // 5. Actualizar Supabase
      // DETALLE IMPORTANTE: World Tour usa su propia tabla 'world_tours', el resto usa 'users'.
      const targetTable = commandName === 'world_tour' ? 'world_tours' : 'users';

      const { error } = await supabase
        .from(targetTable)
        .update(updateData)
        .eq('user_id', targetUser.id);

      if (error) {
        console.error('Error Supabase:', error);
        return interaction.editReply({ content: '❌ Ocurrió un error al intentar actualizar la base de datos (Posiblemente el usuario no ha iniciado el tour o no existe).' });
      }

      // 6. Confirmación
      return interaction.editReply({
        content: `✅ **Cooldown Reseteado Correctamente**\n\n👤 **Usuario:** ${targetUser}\n⚙️ **Comando:** \`/${commandName}\`\n📝 **Razón:** ${reason}`
      });

    } catch (error) {
      console.error('Error en reset_cooldown:', error);
      return interaction.editReply({ content: '❌ Ocurrió un error interno al ejecutar el comando.' }).catch(() => {});
    }
  }
};
