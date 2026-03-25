const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ComponentType
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN EMOJIS ---
const moneyEmoji = '<:berrycoin:1411737957081288724>';
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
    .setName('transfer')
    .setDescription('💸 Transfiere cartas, dinero, packs o colecciones a otro usuario')
    .addUserOption(opt => 
      opt.setName('user')
        .setDescription('¿A quién le vas a transferir?')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('codes')
        .setDescription('Códigos de cartas específicas (separados por espacio)')
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('money')
        .setDescription('Cantidad de Berrycoins a transferir')
        .setMinValue(1)
        .setRequired(false)
    )
    .addStringOption(opt =>
        opt.setName('pack')
          .setDescription('Selecciona un pack para transferir (1 unidad)')
          .setAutocomplete(true)
          .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('groups')
        .setDescription('Transferir TODAS las cartas de un grupo')
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('idols')
        .setDescription('Transferir TODAS las cartas de un idol')
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('rarity')
        .setDescription('Filtrar transferencia por rareza (1, 2 o 3)')
        .setMinValue(1)
        .setMaxValue(3)
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('eras')
        .setDescription('Filtrar transferencia por Era')
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Mensaje o razón de la transferencia (Opcional)')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const focusName = interaction.options.getFocused(true).name;
    const userId = interaction.user.id;

    // Autocompletado de PACKS
    if (focusName === 'pack') {
        const { data: userPacks } = await supabase
            .from('user_packs')
            .select('quantity, packs(code, name)') 
            .eq('user_id', userId)
            .gt('quantity', 0);

        if (!userPacks || userPacks.length === 0) return interaction.respond([]);

        const choices = userPacks.map(up => ({
            name: `${up.packs.name} (Tienes: ${up.quantity})`, 
            value: up.packs.code
        }));

        const filtered = choices.filter(c => c.name.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
        return interaction.respond(filtered);
    }

    if (focusName === 'groups') {
      const { data } = await supabase.from('base_cards').select('group_name').not('group_name', 'is', null);
      const unique = [...new Set(data.map(g => g.group_name))];
      const filtered = unique.filter(g => g.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(g => ({ name: g, value: g })));
    }
    
    if (focusName === 'idols') {
      const { data } = await supabase.from('base_cards').select('name');
      const unique = [...new Set(data.map(i => i.name.split(' — ')[0].trim()))];
      const filtered = unique.filter(n => n.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(n => ({ name: n, value: n })));
    }

    if (focusName === 'eras') {
      const { data } = await supabase.from('base_cards').select('era').not('era', 'is', null);
      const unique = [...new Set(data.map(e => e.era))];
      const filtered = unique.filter(e => e.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(e => ({ name: e, value: e })));
    }
  },

  async execute(interaction) {
    const sender = interaction.user;
    const receiver = interaction.options.getUser('user');
    
    // Inputs
    const codesInput = interaction.options.getString('codes');
    const moneyAmount = interaction.options.getInteger('money');
    const packCode = interaction.options.getString('pack');
    const groupFilter = interaction.options.getString('groups');
    const idolFilter = interaction.options.getString('idols');
    const rarityFilter = interaction.options.getInteger('rarity');
    const eraFilter = interaction.options.getString('eras');
    const reason = interaction.options.getString('reason') || 'Sin mensaje adjunto';

    // Validaciones
    if (sender.id === receiver.id) return interaction.reply({ content: '❌ No puedes transferirte cosas a ti mismo.', ephemeral: true });
    if (receiver.bot) return interaction.reply({ content: '❌ No puedes transferirle cosas a un bot.', ephemeral: true });
    
    if (!codesInput && !moneyAmount && !packCode && !groupFilter && !idolFilter && !rarityFilter && !eraFilter) {
      return interaction.reply({ content: '⚠️ Debes especificar qué quieres transferir.', ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // === PASO 1: PRE-CÁLCULO ===
      let validTransfer = false;
      let senderMoneyData = null;
      let packToTransfer = null;
      let cardsToTransfer = [];
      
      let moneyText = '';
      let packText = '';

      // A) Dinero
      if (moneyAmount) {
        const { data } = await supabase.from('users').select('balance').eq('user_id', sender.id).single();
        senderMoneyData = data;
        if (!senderMoneyData || senderMoneyData.balance < moneyAmount) {
          return interaction.editReply(`❌ No tienes suficientes ${moneyEmoji} para enviar ${moneyAmount}.`);
        }
        moneyText = `💰 **Dinero:** ${moneyAmount} ${moneyEmoji}\n`;
        validTransfer = true;
      }

      // B) Pack
      if (packCode) {
        const { data: userPack } = await supabase
            .from('user_packs')
            .select('id, quantity, packs(name, emoji)')
            .eq('user_id', sender.id)
            .eq('pack_code', packCode)
            .single();

        if (!userPack || userPack.quantity < 1) {
            return interaction.editReply('❌ No tienes ese pack en tu inventario.');
        }
        packToTransfer = userPack;
        packText = `🎁 **Pack:** ${userPack.packs.emoji} ${userPack.packs.name} (x1)\n`;
        validTransfer = true;
      }

      // C) Cartas
      if (codesInput || groupFilter || idolFilter || rarityFilter || eraFilter) {
        let query = supabase
          .from('user_cards')
          .select(`
            id, 
            unique_card_id,
            rarity, 
            base_cards!inner (name, group_name, rarity_level, era)
          `)
          .eq('user_id', sender.id);

        if (codesInput) {
          const codesArr = codesInput.split(/[\s,]+/).filter(c => c);
          query = query.in('unique_card_id', codesArr);
        }
        if (groupFilter) query = query.ilike('base_cards.group_name', `%${groupFilter}%`);
        if (idolFilter) query = query.ilike('base_cards.name', `%${idolFilter}%`);
        if (eraFilter) query = query.ilike('base_cards.era', `%${eraFilter}%`);
        if (rarityFilter) query = query.eq('rarity', rarityFilter);

        const { data, error } = await query;
        if (error) { console.error(error); return interaction.editReply('❌ Error al buscar cartas.'); }
        
        if (data && data.length > 0) {
          cardsToTransfer = data;
          validTransfer = true;
        } else if (!validTransfer) {
          return interaction.editReply('❌ No se encontraron cartas tuyas con esos filtros.');
        }
      }

      if (!validTransfer) return interaction.editReply('❌ No hay nada válido para transferir.');

      // === PASO 2: CONSTRUCCIÓN VISUAL (GRID) ===
      
      const confirmEmbed = new EmbedBuilder()
        .setColor('#f1c40f')
        .setTitle('⚠️ Confirmar Transferencia')
        .setDescription(
            `Estás a punto de transferir a **${receiver}**:\n` +
            `${moneyText}` +
            `${packText}` +
            (cardsToTransfer.length > 0 ? `\n🃏 **Cartas (${cardsToTransfer.length}):**` : '')
        )
        .setFooter({ text: 'Tienes 60 segundos para confirmar.' });

      // 3. AGREGAR CAMPOS DE CARTAS (Max 15)
      if (cardsToTransfer.length > 0) {
        const maxPreview = 15;
        const displayCards = cardsToTransfer.slice(0, maxPreview);
        
        displayCards.forEach(card => {
            const cleanName = card.base_cards.name.split(' — ')[0].trim();
            const rarityEmoji = getRarityEmoji(card.rarity || 1);
            
            confirmEmbed.addFields({
                name: `${cleanName} ${rarityEmoji}`,
                value: `${card.base_cards.group_name}\n\`${card.unique_card_id}\``,
                inline: true 
            });
        });

        if (cardsToTransfer.length > maxPreview) {
            confirmEmbed.addFields({
                name: '...y más',
                value: `+${cardsToTransfer.length - maxPreview} cartas adicionales.`,
                inline: false
            });
        }
      }

      // Botones
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_transfer').setLabel('Aceptar').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('cancel_transfer').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('✖️')
      );

      const message = await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

      // === PASO 3: CAPTURAR EL CLIC ===
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
        filter: i => i.user.id === sender.id
      });

      collector.on('collect', async i => {
        if (i.customId === 'cancel_transfer') {
          collector.stop('cancelled'); 
          await i.update({ content: '❌ Transferencia cancelada.', embeds: [], components: [] });
          return;
        }

        if (i.customId === 'confirm_transfer') {
          collector.stop('confirmed'); 

          // --- EJECUCIÓN ---
          // 1. Dinero
          if (moneyAmount) {
            await supabase.from('users').update({ balance: senderMoneyData.balance - moneyAmount }).eq('user_id', sender.id);
            let { data: rData } = await supabase.from('users').select('balance').eq('user_id', receiver.id).single();
            if (!rData) await supabase.from('users').insert({ user_id: receiver.id, username: receiver.username, balance: moneyAmount });
            else await supabase.from('users').update({ balance: rData.balance + moneyAmount }).eq('user_id', receiver.id);
          }

          // 2. Packs
          if (packToTransfer) {
             await supabase.from('user_packs').update({ quantity: packToTransfer.quantity - 1 }).eq('id', packToTransfer.id);
             const { data: existingRPack } = await supabase.from('user_packs').select('id, quantity').eq('user_id', receiver.id).eq('pack_code', packCode).single();
             const newQty = (existingRPack?.quantity || 0) + 1;
             await supabase.from('user_packs').upsert({ user_id: receiver.id, pack_code: packCode, quantity: newQty }, { onConflict: ['user_id', 'pack_code'] });
          }

          // 3. Cartas
          if (cardsToTransfer.length > 0) {
             const ids = cardsToTransfer.map(c => c.id);
             await supabase.from('user_cards').update({ user_id: receiver.id }).in('id', ids);
          }

          // --- LOG HISTORIAL ---
          let details = `Envío a ${receiver.username}: `;
          if (moneyAmount) details += `${moneyAmount} coins. `;
          if (packCode) details += `1 pack (${packCode}). `;
          if (cardsToTransfer.length > 0) details += `${cardsToTransfer.length} cartas.`;

          await supabase.from('history_logs').insert({
              user_id: sender.id,
              action_type: 'pack_trade', 
              target_id: receiver.id,
              details: details.trim()
          });

          // --- CONSTRUCCIÓN DE LA LISTA DETALLADA PARA EL MENSAJE FINAL ---
          let cardListText = '';
          if (cardsToTransfer.length > 0) {
              const lines = cardsToTransfer.map(c => {
                  const emoji = getRarityEmoji(c.rarity || 1);
                  const cleanName = c.base_cards.name.split(' — ')[0].trim();
                  // Formato: 🍓 Idol - Grupo (Era)
                  return `> ${emoji} **${cleanName}** - ${c.base_cards.group_name} *(${c.base_cards.era})*`;
              });

              // Si son muchas, cortamos para no romper el límite de Discord (2000-4000 caracteres)
              if (lines.length > 20) {
                  cardListText = `\n**🃏 Cartas Transferidas (${cardsToTransfer.length}):**\n` + lines.slice(0, 20).join('\n') + `\n...y ${lines.length - 20} más.`;
              } else {
                  cardListText = `\n**🃏 Cartas Transferidas (${cardsToTransfer.length}):**\n` + lines.join('\n');
              }
          }

          // --- MENSAJE FINAL MODIFICADO ---
          const successEmbed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('✅ Transferencia Completada')
            .setDescription(
                `**De:** ${sender}\n**Para:** ${receiver}\n\n` +
                (moneyText ? moneyText : '') +
                (packText ? packText : '') +
                cardListText // <--- AQUÍ VA LA LISTA DETALLADA
            )
            .addFields({ name: '📝 Mensaje', value: `*${reason}*` })
            .setTimestamp();

          // 1. Aceptamos el click del botón para que no se quede pensando
          await i.update({ components: [] });

          // 2. Borramos el mensaje de "¿Confirmar transferencia?" para mantener limpio el chat
          await interaction.deleteReply().catch(() => {});

          // 3. Enviamos el resultado como un MENSAJE NUEVO (Esto obliga a Discord a mandar la notificación real)
          await interaction.channel.send({ 
            content: `🔔 <@${receiver.id}> ¡Te ha llegado una transferencia de ${sender}!`,
            embeds: [successEmbed] 
          });
        }
      });

      collector.on('end', (_, reason) => {
        if (reason === 'time') {
          interaction.editReply({ content: '⏳ Tiempo de espera agotado. La transferencia se canceló.', embeds: [], components: [] }).catch(() => {});
        }
      });

    } catch (err) {
      console.error('Error en transfer:', err);
      await interaction.editReply('❌ Ocurrió un error inesperado.');
    }
  }
};
