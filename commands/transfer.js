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

// Emoji de moneda
const moneyEmoji = '<:berrycoin:1411737957081288724>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transfer')
    .setDescription('💸 Transfiere cartas, dinero o colecciones a otro usuario')
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
    const groupFilter = interaction.options.getString('groups');
    const idolFilter = interaction.options.getString('idols');
    const rarityFilter = interaction.options.getInteger('rarity');
    const eraFilter = interaction.options.getString('eras');
    const reason = interaction.options.getString('reason') || 'Sin mensaje adjunto';

    // Validaciones básicas
    if (sender.id === receiver.id) return interaction.reply({ content: '❌ No puedes transferirte cosas a ti mismo.', ephemeral: true });
    if (receiver.bot) return interaction.reply({ content: '❌ No puedes transferirle cosas a un bot.', ephemeral: true });
    
    if (!codesInput && !moneyAmount && !groupFilter && !idolFilter && !rarityFilter && !eraFilter) {
      return interaction.reply({ content: '⚠️ Debes especificar qué quieres transferir.', ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // === PASO 1: PRE-CÁLCULO (Verificar qué se va a enviar antes de hacerlo) ===
      
      let confirmMessage = `Estás a punto de transferir a **${receiver.username}**:\n`;
      let validMoney = false;
      let cardsToTransfer = [];

      // A) Verificación de Dinero
      if (moneyAmount) {
        const { data: senderData } = await supabase.from('users').select('balance').eq('user_id', sender.id).single();
        if (!senderData || senderData.balance < moneyAmount) {
          return interaction.editReply(`❌ No tienes suficientes ${moneyEmoji} (${senderData?.balance || 0}) para enviar ${moneyAmount}.`);
        }
        confirmMessage += `💰 **${moneyAmount}** ${moneyEmoji}\n`;
        validMoney = true;
      }

      // B) Verificación de Cartas
      if (codesInput || groupFilter || idolFilter || rarityFilter || eraFilter) {
        let query = supabase
          .from('user_cards')
          .select(`id, unique_card_id, base_cards!inner (name, group_name)`)
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
          confirmMessage += `🃏 **${data.length} Cartas** (con los filtros seleccionados)\n`;
        } else if (!validMoney) {
          return interaction.editReply('❌ No se encontraron cartas tuyas que coincidan con esos filtros.');
        }
      }

      // Si no hay nada válido para enviar
      if (!validMoney && cardsToTransfer.length === 0) {
        return interaction.editReply('❌ No hay nada válido para transferir.');
      }

      // === PASO 2: BOTONES DE CONFIRMACIÓN ===

      const confirmEmbed = new EmbedBuilder()
        .setColor('#f1c40f') // Amarillo de advertencia
        .setTitle('⚠️ Confirmar Transferencia')
        .setDescription(confirmMessage + `\n📝 **Nota:** ${reason}`)
        .setFooter({ text: 'Tienes 30 segundos para confirmar' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('confirm_transfer')
          .setLabel('Confirmar')
          .setStyle(ButtonStyle.Success) // Verde
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId('cancel_transfer')
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger) // Rojo
          .setEmoji('✖️')
      );

      const message = await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

      // === PASO 3: CAPTURAR EL CLIC ===
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 30000, // 30 segundos
        filter: i => i.user.id === sender.id // Solo quien ejecutó el comando puede confirmar
      });

      collector.on('collect', async i => {
        if (i.customId === 'cancel_transfer') {
          await i.update({ content: '❌ Transferencia cancelada.', embeds: [], components: [] });
          return;
        }

        if (i.customId === 'confirm_transfer') {
          // --- EJECUCIÓN REAL DE LA TRANSFERENCIA ---
          
          // 1. Dinero
          if (validMoney) {
            // Restar al sender
            const { data: sBalance } = await supabase.from('users').select('balance').eq('user_id', sender.id).single();
            await supabase.from('users').update({ balance: sBalance.balance - moneyAmount }).eq('user_id', sender.id);
            
            // Sumar al receiver (crear si no existe)
            let { data: rData } = await supabase.from('users').select('balance').eq('user_id', receiver.id).single();
            if (!rData) {
               await supabase.from('users').insert({ user_id: receiver.id, username: receiver.username, balance: moneyAmount });
            } else {
               await supabase.from('users').update({ balance: rData.balance + moneyAmount }).eq('user_id', receiver.id);
            }
          }

          // 2. Cartas
          if (cardsToTransfer.length > 0) {
             const ids = cardsToTransfer.map(c => c.id);
             await supabase.from('user_cards').update({ user_id: receiver.id }).in('id', ids);
          }

          // --- MENSAJE FINAL + PING ---
          const successEmbed = new EmbedBuilder()
            .setColor('#2ecc71') // Verde éxito
            .setTitle('✅ Transferencia Completada')
            .setDescription(`**De:** ${sender}\n**Para:** ${receiver}\n\n${confirmMessage}`)
            .addFields({ name: '📝 Mensaje', value: `*${reason}*` })
            .setTimestamp();

          await i.update({ 
            content: `🔔 <@${receiver.id}> ¡Te ha llegado una transferencia!`, // AQUÍ ESTÁ EL PING
            embeds: [successEmbed], 
            components: [] 
          });
        }
      });

      collector.on('end', (_, reason) => {
        if (
