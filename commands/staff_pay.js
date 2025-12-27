const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- CONFIGURACIÓN DE SALARIOS ---
const PAY_PER_CREATE = 750; // Pago por CADA carta creada (x3 por comando)
const PAY_PER_CLAIM = 1000;  // Pago por CADA carta reclamada (claim_creador)
const MONEY_EMOJI = '<:berrycoin:1411737957081288724>';

// Roles permitidos para PAGAR (Tus admins)
const ALLOWED_ROLES = ['1413313501694263357', '1412852141197885464', '1448869974218375210'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staff_pay')
    .setDescription('ADMIN: Paga a los creadores y resetea sus contadores mensuales.')
    .addBooleanOption(opt => 
        opt.setName('confirmar')
        .setDescription('TRUE para pagar de verdad. FALSE para solo ver la simulación.')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Verificar Permisos
    const memberRoles = interaction.member.roles.cache;
    if (!ALLOWED_ROLES.some(r => memberRoles.has(r))) {
        return interaction.reply({ content: '🚫 Solo los administradores pueden gestionar pagos.', ephemeral: true });
    }

    const executePay = interaction.options.getBoolean('confirmar');

    try {
      await interaction.deferReply();

      // 1. Buscar usuarios con trabajo pendiente
      const { data: staffUsers, error } = await supabase
        .from('users')
        .select('user_id, pending_creates, pending_claims, balance')
        .or('pending_creates.gt.0,pending_claims.gt.0');

      if (error) throw error;

      if (!staffUsers || staffUsers.length === 0) {
        return interaction.editReply('✅ Todo está pagado. No hay trabajo pendiente registrado.');
      }

      const reportLines = [];
      let totalPaid = 0;

      // 2. Calcular y (si es true) Pagar
      for (const user of staffUsers) {
        const creates = user.pending_creates || 0;
        const claims = user.pending_claims || 0;

        const payForCreates = creates * PAY_PER_CREATE;
        const payForClaims = claims * PAY_PER_CLAIM;
        const totalUserPay = payForCreates + payForClaims;

        totalPaid += totalUserPay;

        reportLines.push(
            `<@${user.user_id}>: **${totalUserPay}** ${MONEY_EMOJI}\n` +
            `└─ 🎨 ${creates} Creates | 🏷️ ${claims} Claims`
        );

        // EJECUTAR PAGO REAL
        if (executePay) {
            await supabase.from('users').update({
                balance: (user.balance || 0) + totalUserPay,
                pending_creates: 0, // Reset
                pending_claims: 0   // Reset
            }).eq('user_id', user.user_id);

            // Log Historial
            await supabase.from('history_logs').insert({
                user_id: user.user_id,
                action_type: 'staff_pay',
                amount: totalUserPay,
                details: `Pago Staff: ${creates} Creates, ${claims} Claims`
            });

            // --- NUEVO: PING AL USUARIO CON EL MONTO ---
            await interaction.channel.send({
                content: `💸 **¡Pago Enviado!** <@${user.user_id}> has recibido **${totalUserPay}** ${MONEY_EMOJI} por tu trabajo este mes.`
            });
        }
      }

      // 3. Respuesta Visual (Resumen para el admin)
      const embed = new EmbedBuilder()
        .setColor(executePay ? '#2ecc71' : '#f1c40f')
        .setTitle(executePay ? '💸 ¡Pagos de Staff Realizados!' : '📊 Simulación de Nómina')
        .setDescription(
            `Se han procesado **${staffUsers.length}** miembros del staff.\n` +
            `**Total a Pagar:** ${totalPaid} ${MONEY_EMOJI}\n\n` +
            `**Detalle:**\n${reportLines.join('\n\n')}`
        )
        .setFooter({ text: executePay ? 'Los contadores se han reiniciado a 0.' : 'MODO SIMULACIÓN: No se entregó dinero ni se borraron contadores.' });

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error staff_pay:', err);
      await interaction.editReply('❌ Error al procesar la nómina.');
    }
  }
};
