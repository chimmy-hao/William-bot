const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ComponentType,
  AttachmentBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN EMOJIS ---
const strawberryEmoji = '<:strawberrity:1411384728119939182>'; 

// Helper para estrellas/fresas
const getRarityEmoji = (level) => {
  if (level === 1) return strawberryEmoji;
  if (level === 2) return `${strawberryEmoji}${strawberryEmoji}`;
  if (level === 3) return `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`;
  return strawberryEmoji;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trade')
    .setDescription('🔄 Inicia un intercambio de cartas con otro usuario')
    .addUserOption(opt => 
      opt.setName('trade_with')
        .setDescription('¿Con quién quieres intercambiar?')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('offer')
        .setDescription('TUS códigos para dar (separados por espacio)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('request')
        .setDescription('Los códigos que PIDES a la otra persona (separados por espacio)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const sender = interaction.user;
    const target = interaction.options.getUser('trade_with');
    
    // Filtros iniciales
    if (sender.id === target.id) return interaction.reply({ content: '❌ No puedes intercambiar contigo mismo.', ephemeral: true });
    if (target.bot) return interaction.reply({ content: '❌ No puedes intercambiar con bots.', ephemeral: true });

    const offerCodesRaw = interaction.options.getString('offer').split(/[\s,]+/);
    const requestCodesRaw = interaction.options.getString('request').split(/[\s,]+/);

    const offerCodes = [...new Set(offerCodesRaw.filter(c => c))];
    const requestCodes = [...new Set(requestCodesRaw.filter(c => c))];

    try {
      await interaction.deferReply();

      // 1. Validar Propiedad de Cartas
      // Mis cartas (sender)
      const { data: myCards } = await supabase
        .from('user_cards')
        .select('id, unique_card_id, rarity, base_cards(name, group_name)')
        .in('unique_card_id', offerCodes)
        .eq('user_id', sender.id);

      // Sus cartas (target)
      const { data: theirCards } = await supabase
        .from('user_cards')
        .select('id, unique_card_id, rarity, base_cards(name, group_name)')
        .in('unique_card_id', requestCodes)
        .eq('user_id', target.id);

      // Verificaciones
      if (!myCards || myCards.length !== offerCodes.length) {
        return interaction.editReply(`❌ Error: No posees todas las cartas que ofreces o escribiste mal un código.`);
      }
      if (!theirCards || theirCards.length !== requestCodes.length) {
        return interaction.editReply(`❌ Error: <@${target.id}> no posee todas las cartas que pides.`);
      }

      // 2. Crear Embed de Contrato
      const embed = new EmbedBuilder()
        .setColor('#3498db')
        .setTitle('🤝 Propuesta de Intercambio')
        .setDescription(`<@${sender.id}> quiere intercambiar con <@${target.id}>`)
        .addFields(
            { 
                name: `📤 ${sender.username} Ofrece:`, 
                value: myCards.map(c => `• ${c.base_cards.name} (${getRarityEmoji(c.rarity)})`).join('\n'), 
                inline: true 
            },
            { 
                name: `📥 ${target.username} Entrega:`, 
                value: theirCards.map(c => `• ${c.base_cards.name} (${getRarityEmoji(c.rarity)})`).join('\n'), 
                inline: true 
            }
        )
        .setFooter({ text: 'Ambas partes deben confirmar para procesar.' });

      // Botones
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accept_trade').setLabel('✅ Aceptar Trato').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_trade').setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger)
      );

      const message = await interaction.editReply({ content: `🔔 <@${target.id}>, tienes una oferta de intercambio.`, embeds: [embed], components: [row] });

      // 3. Lógica de Confirmación (Collector)
      // Necesitamos que el TARGET acepte. El Sender ya aceptó al enviar el comando (o podemos pedirle confirmación también, 
      // pero para simplificar, asumimos que Sender acepta, y solo Target debe dar click).
      // MEJORA: Para seguridad total, a veces se pide que AMBOS den click. Aquí solo pediremos al TARGET para agilizar.
      
      const collector = message.createMessageComponentCollector({ 
        componentType: ComponentType.Button, 
        time: 120000 
      });

      collector.on('collect', async i => {
        // Cancelar (Cualquiera de los dos puede cancelar)
        if (i.customId === 'cancel_trade') {
            if (i.user.id === sender.id || i.user.id === target.id) {
                collector.stop('cancelled');
                await i.update({ content: '❌ Intercambio cancelado.', embeds: [], components: [] });
            } else {
                await i.reply({ content: 'No eres parte de este intercambio.', ephemeral: true });
            }
            return;
        }

        // Aceptar (Solo el Target)
        if (i.customId === 'accept_trade') {
            if (i.user.id !== target.id) {
                return i.reply({ content: '⏳ Estamos esperando que la otra persona acepte.', ephemeral: true });
            }

            // RE-VERIFICACIÓN DE PROPIEDAD (Critical Section)
            // Verificar que aun tengan las cartas (por si las vendieron mientras esperaban)
            const { count: checkMyCards } = await supabase.from('user_cards').select('*', { count: 'exact', head: true }).in('id', myCards.map(c => c.id)).eq('user_id', sender.id);
            const { count: checkTheirCards } = await supabase.from('user_cards').select('*', { count: 'exact', head: true }).in('id', theirCards.map(c => c.id)).eq('user_id', target.id);

            if (checkMyCards !== myCards.length || checkTheirCards !== theirCards.length) {
                collector.stop('error');
                return i.update({ content: '❌ **Error:** Alguien perdió las cartas durante la espera (¿quizás las vendió o recicló?). Operación cancelada.', components: [] });
            }

            // Ejecución
            await supabase.from('user_cards').update({ user_id: target.id }).in('id', myCards.map(c => c.id));
            await supabase.from('user_cards').update({ user_id: sender.id }).in('id', theirCards.map(c => c.id));

            // --- HISTORIAL (Logs para ambos) ---
            // 1. Log para el que envió la oferta
            await supabase.from('history_logs').insert({
                user_id: sender.id,
                action_type: 'pack_trade', // Usamos 'trade' o 'pack_trade' para el icono de 🤝
                target_id: target.id,
                details: `Intercambió ${myCards.length} cartas suyas por ${theirCards.length} de ${target.username}`
            });

            // 2. Log para el que aceptó
            await supabase.from('history_logs').insert({
                user_id: target.id,
                action_type: 'pack_trade',
                target_id: sender.id,
                details: `Intercambió ${theirCards.length} cartas suyas por ${myCards.length} de ${sender.username}`
            });
            // -----------------------------------

            collector.stop('accepted');
            
            await i.update({ 
                content: `✅ **¡Intercambio Exitoso!**\n🤝 <@${sender.id}> y <@${target.id}> han completado el trato.`,
                components: []
            });
        }
      });

      collector.on('end', (_, reason) => {
        if (reason === 'time') {
            interaction.editReply({ content: '⏳ La oferta de intercambio expiró.', components: [] }).catch(() => {});
        }
      });

    } catch (err) {
      console.error('Error en trade:', err);
      interaction.editReply({ content: '❌ Ocurrió un error inesperado.' }).catch(() => {});
    }
  }
};
