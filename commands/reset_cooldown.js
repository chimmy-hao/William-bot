const { SlashCommandBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Conexión a Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// IDs de roles permitidos (Managers/Admins)
const ALLOWED_ROLES = ['1413313501694263357', '1412852141197885464'];

// MAPA DE CONFIGURACIÓN
const COMMAND_DB_MAP = {
  'photocard':  { last_photocard_claim: 0, photocard_notified: false },
  'work':       { last_work_claim: 0, work_notified: false },
  'daily':      { last_daily_claim: 0, daily_notified: false },
  'weekly':     { last_weekly_claim: 0, weekly_notified: false },
  'alpha':      { alpha_uses: 0, alpha_reset_time: 0, alpha_notified: false },      
  'licuadora':  { licuadora_uses: 0, licuadora_reset_time: 0, licuadora_notified: false },
  'world_tour': { last_checkin: 0 } 
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
          { name: '🌍 World Tour', value: 'world_tour' }
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

      // 4. Copiar configuración para poder modificarla
      // Usamos Spread syntax (...) para crear una copia y no modificar la constante original
      let updateData = { ...COMMAND_DB_MAP[commandName] };

      if (!updateData) {
        return interaction.editReply({ content: '❌ Error de configuración: El comando no está en la lista de reseteo.' });
      }

      // 5. LÓGICA ESPECIAL PARA WORLD TOUR
      // Si queremos repetir el concierto, tenemos que restar 1 a la ciudad actual.
      // Así, cuando use "next_concert" (que suma 1), volverá al mismo número.
      let targetTable = 'users'; // Por defecto tabla users

      if (commandName === 'world_tour') {
          targetTable = 'world_tours';
          
          // Consultar en qué ciudad está el usuario ahora
          const { data: tourData } = await supabase
              .from('world_tours')
              .select('current_city')
              .eq('user_id', targetUser.id)
              .single();

          if (tourData) {
              // Restamos 1, pero evitamos que baje de 0
              const previousCity = Math.max(0, tourData.current_city - 1);
              updateData.current_city = previousCity;
          }
      }

      // 6. Actualizar Supabase
      const { error } = await supabase
        .from(targetTable)
        .update(updateData)
        .eq('user_id', targetUser.id);

      if (error) {
        console.error('Error Supabase:', error);
        return interaction.editReply({ content: '❌ Ocurrió un error al intentar actualizar la base de datos.' });
      }

      // 7. Confirmación
      let extraInfo = '';
      if (commandName === 'world_tour') {
          extraInfo = '\n🔙 **Nota:** Se ha retrocedido el contador para repetir el concierto.';
      }

      return interaction.editReply({
        content: `✅ **Cooldown Reseteado Correctamente**\n\n👤 **Usuario:** ${targetUser}\n⚙️ **Comando:** \`/${commandName}\`\n📝 **Razón:** ${reason}${extraInfo}`
      });

    } catch (error) {
      console.error('Error en reset_cooldown:', error);
      return interaction.editReply({ content: '❌ Ocurrió un error interno al ejecutar el comando.' }).catch(() => {});
    }
  }
};
