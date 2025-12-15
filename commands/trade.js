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
        .setDescription('Los códigos que PIDES a cambio (separados por espacio)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const sender = interaction.user;
    const target = interaction.options.getUser('trade_with');
    const offerInput = interaction.options.getString('offer');
    const requestInput = interaction.options.getString('request');

    // 1. Validaciones básicas
    if (sender.id === target.id) return interaction.reply({ content: '❌ No puedes intercambiar contigo mismo.', ephemeral: true });
    if (target.bot) return interaction.reply({ content: '❌ No puedes intercambiar con bots.', ephemeral: true });

    const offerCodes = [...new Set(offerInput.split(/[\s,]+/).filter(c => c))];
    const requestCodes = [...new Set(requestInput.split(/[\s,]+/).filter(c => c))];

    if (offerCodes.length === 0 || requestCodes.length === 0) {
      return interaction.reply({ content: '❌ Debes escribir códigos válidos en ambos campos.', ephemeral: true });
    }

    if (offerCodes.length > 6 || requestCodes.length > 6) {
        return interaction.reply({ content: '❌ Por seguridad visual, máximo 6 cartas por lado en cada intercambio.', ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // 2. VERIFICACIÓN DE PROPIEDAD
      
      // A) Verificar mis cartas
      const { data: myCards, error: myError } = await supabase
        .from('user_cards')
        .select(`id, unique_card_id, rarity, base_cards!inner (name, group_name, image_url, rarity_level)`)
        .eq('user_id', sender.id)
        .in('unique_card_id', offerCodes);

      if (myError) { console.error(myError); return interaction.editReply('❌ Error al verificar tus cartas.'); }

      const foundMyIds = myCards.map(c => c.unique_card_id);
      const missingMine = offerCodes.filter(code => !foundMyIds.includes(code));
      if (missingMine.length > 0) {
        return interaction.editReply(`❌ **Error:** No posees las siguientes cartas (o códigos erróneos):\n\`${missingMine.join(', ')}\``);
      }

      // B) Verificar sus cartas
      const { data: theirCards, error: theirError } = await supabase
        .from('user_cards')
        .select(`id, unique_card_id, rarity, base_cards!inner (name, group_name, image_url, rarity_level)`)
        .eq('user_id', target.id)
        .in('unique_card_id', requestCodes);

      if (theirError) { console.error(theirError); return interaction.editReply('❌ Error al verificar las cartas del otro usuario.'); }

      const foundTheirIds = theirCards.map(c => c.unique_card_id);
      const missingTheirs = requestCodes.filter(code => !foundTheirIds.includes(code));
      if (missingTheirs.length > 0) {
        return interaction.editReply(`❌ **Error:** ${target.username} no posee las siguientes cartas:\n\`${missingTheirs.join(', ')}\``);
      }

      // 3. GENERACIÓN DE IMAGEN (Canvas)
      const cardWidth = 150;
      const cardHeight = 220;
      const gap = 15; 
      const maxCols = Math.max(myCards.length, theirCards.length);
      
      const canvasWidth = (cardWidth * maxCols) + (gap * (maxCols + 1));
      const canvasHeight = (cardHeight * 2) + 80;

      const canvas = createCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext('2d');

      const drawRow = async (cards, yOffset, label) => {
        ctx.fillStyle = '#ffffff';
        ctx.font = '17px Arial'; 
        ctx.fillText(label, 10, yOffset - 10);

        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const x = gap + (i * (cardWidth + gap));
            try {
                const img = await loadImage(card.base_cards.image_url);
                const radius = 10; 
                
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x + radius, yOffset);
                ctx.lineTo(x + cardWidth - radius, yOffset);
                ctx.quadraticCurveTo(x + cardWidth, yOffset, x + cardWidth, yOffset + radius);
                ctx.lineTo(x + cardWidth, yOffset + cardHeight - radius);
                ctx.quadraticCurveTo(x + cardWidth, yOffset + cardHeight, x + cardWidth - radius, yOffset + cardHeight);
                ctx.lineTo(x + radius, yOffset + cardHeight);
                ctx.quadraticCurveTo(x, yOffset + cardHeight, x, yOffset + cardHeight - radius);
                ctx.lineTo(x, yOffset + radius);
                ctx.quadraticCurveTo(x, yOffset, x + radius, yOffset);
                ctx.closePath();
                ctx.clip();
                
                ctx.drawImage(img, x, yOffset, cardWidth, cardHeight);
                ctx.restore();
            } catch (e) {
                console.error('Error loading img', e);
            }
        }
      };

      await drawRow(myCards, 40, `Tú ofreces:`);
      await drawRow(theirCards, 40 + cardHeight + 40, `${target.username} ofrece:`);

      const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'trade_preview.png' });

      // 4. EMBED MEJORADO
      const formatList = (cards) => {
        return cards.map(c => {
            const rEmoji = getRarityEmoji(c.rarity || c.base_cards.rarity_level);
            const cleanName = c.base_cards.name.split(' — ')[0].trim();
            // Formato más limpio y compacto
            return `\`${c.unique_card_id}\` **${cleanName}** ${rEmoji}`;
        }).join('\n');
      };

      const embed = new EmbedBuilder()
        .setColor('#2ecc71') // Verde negociación
        .setTitle('🔄 Propuesta de Intercambio')
        .setDescription(`<@${sender.id}> quiere intercambiar cartas con <@${target.id}>.`)
        .addFields(
            { name: `📤 ${sender.username} Entrega:`, value: formatList(myCards), inline: true },
            { name: `📥 ${target.username} Entrega:`, value: formatList(theirCards), inline: true }
        )
        .setImage('attachment://trade_preview.png')
        .setFooter({ text: 'Ambos usuarios deben confirmar para realizar el trato.' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accept_trade').setLabel('Aceptar Intercambio').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('deny_trade').setLabel('Rechazar').setStyle(ButtonStyle.Danger).setEmoji('✖️')
      );

      // 5. ENVÍO + PING FORZADO (allowedMentions)
      const message = await interaction.editReply({ 
        content: `🔔 **¡Atención!** <@${target.id}>, tienes una oferta de intercambio.`,
        embeds: [embed], 
        files: [attachment],
        components: [row],
        allowedMentions: { users: [target.id] } // <--- ESTO ARREGLA EL PING
      });

      // 6. COLLECTOR
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000 * 2, 
        filter: i => i.user.id === target.id 
      });

      collector.on('collect', async i => {
        if (i.customId === 'deny_trade') {
            collector.stop('denied');
            await i.update({ 
                content: `❌ **Intercambio rechazado** por ${target}.`, 
                components: [] 
            });
            return;
        }

        if (i.customId === 'accept_trade') {
            // Verificación final (anti-robo/scam de último segundo)
            const { count: checkMyCards } = await supabase.from('user_cards').select('*', { count: 'exact', head: true }).in('id', myCards.map(c => c.id)).eq('user_id', sender.id);
            const { count: checkTheirCards } = await supabase.from('user_cards').select('*', { count: 'exact', head: true }).in('id', theirCards.map(c => c.id)).eq('user_id', target.id);

            if (checkMyCards !== myCards.length || checkTheirCards !== theirCards.length) {
                collector.stop('error');
                return i.update({ content: '❌ **Error:** Alguien perdió las cartas durante la espera (¿quizás las vendió o recicló?). Operación cancelada.', components: [] });
            }

            // Ejecución
            await supabase.from('user_cards').update({ user_id: target.id }).in('id', myCards.map(c => c.id));
            await supabase.from('user_cards').update({ user_id: sender.id }).in('id', theirCards.map(c => c.id));

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
      await interaction.editReply('❌ Ocurrió un error al procesar el intercambio.');
    }
  }
};
