const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
    .setDescription('💸 Transfiere cartas, dinero o colecciones enteras a otro usuario')
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
      // Limpieza de nombre
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
    if (sender.id === receiver.id) {
      return interaction.reply({ content: '❌ No puedes transferirte cosas a ti mismo.', ephemeral: true });
    }
    if (receiver.bot) {
      return interaction.reply({ content: '❌ No puedes transferirle cosas a un bot.', ephemeral: true });
    }
    
    // Verificar que al menos haya ALGO que transferir
    if (!codesInput && !moneyAmount && !groupFilter && !idolFilter && !rarityFilter && !eraFilter) {
      return interaction.reply({ content: '⚠️ Debes especificar qué quieres transferir (dinero, códigos o usar los filtros).', ephemeral: true });
    }

    try {
      await interaction.deferReply();
      const resultLog = []; // Aquí guardaremos qué pasó para el mensaje final

      // --- 1. TRANSFERENCIA DE DINERO ---
      if (moneyAmount) {
        // Obtener balance del que envía
        const { data: senderData } = await supabase.from('users').select('balance').eq('user_id', sender.id).single();
        
        if (!senderData || (senderData.balance < moneyAmount)) {
          return interaction.editReply(`❌ No tienes suficientes ${moneyEmoji} para realizar esta transferencia.`);
        }

        // Obtener/Crear receptor
        let { data: receiverData } = await supabase.from('users').select('*').eq('user_id', receiver.id).single();
        if (!receiverData) {
          const { data: newUser } = await supabase
            .from('users')
            .insert({ user_id: receiver.id, username: receiver.username, balance: 0 })
            .select().single();
          receiverData = newUser;
        }

        // Restar al sender
        await supabase.from('users').update({ balance: senderData.balance - moneyAmount }).eq('user_id', sender.id);
        // Sumar al receiver
        await supabase.from('users').update({ balance: receiverData.balance + moneyAmount }).eq('user_id', receiver.id);

        resultLog.push(`💰 **Dinero:** ${moneyAmount} ${moneyEmoji}`);
      }

      // --- 2. TRANSFERENCIA DE CARTAS ---
      // Verificamos si hay alguna intención de pasar cartas (códigos o filtros)
      if (codesInput || groupFilter || idolFilter || rarityFilter || eraFilter) {
        
        // Construimos la consulta para buscar QUÉ cartas se van a mover
        let query = supabase
          .from('user_cards')
          .select(`
            id, 
            unique_card_id, 
            base_cards!inner (name, group_name, era, rarity_level)
          `)
          .eq('user_id', sender.id); // Solo cartas mías

        // Filtro A: Códigos específicos
        if (codesInput) {
          const codesArr = codesInput.split(/[\s,]+/).filter(c => c);
          query = query.in('unique_card_id', codesArr);
        }

        // Filtro B: Grupos / Idols / Rareza / Era
        if (groupFilter) query = query.ilike('base_cards.group_name', `%${groupFilter}%`);
        if (idolFilter) query = query.ilike('base_cards.name', `%${idolFilter}%`);
        if (eraFilter) query = query.ilike('base_cards.era', `%${eraFilter}%`);
        if (rarityFilter) query = query.eq('rarity', rarityFilter);

        const { data: cardsToTransfer, error: findError } = await query;

        if (findError) {
          console.error(findError);
          return interaction.editReply('❌ Error al buscar las cartas a transferir.');
        }

        if (!cardsToTransfer || cardsToTransfer.length === 0) {
          // Si especificó dinero, al menos el dinero pasó, pero avisamos de las cartas
          if (moneyAmount) resultLog.push('⚠️ **Cartas:** No se encontraron cartas con esos criterios.');
          else return interaction.editReply('❌ No tienes cartas que coincidan con esos códigos o filtros.');
        } else {
          // EJECUTAR TRANSFERENCIA DE CARTAS
          const cardIds = cardsToTransfer.map(c => c.id);
          
          // Actualizamos el dueño de esas cartas
          const { error: updateError } = await supabase
            .from('user_cards')
            .update({ user_id: receiver.id }) // Nuevo dueño
            .in('id', cardIds); // IDs de las cartas encontradas

          if (updateError) {
            console.error(updateError);
            return interaction.editReply('❌ Error crítico al transferir las cartas.');
          }

          resultLog.push(`🃏 **Cartas:** ${cardsToTransfer.length} transferida(s).`);
          
          // Si son pocas (menos de 5), las listamos. Si son muchas, solo la cantidad.
          if (cardsToTransfer.length <= 5) {
             const names = cardsToTransfer.map(c => `\`${c.unique_card_id}\``).join(', ');
             resultLog.push(`> ${names}`);
          }
        }
      }

      // --- 3. CONFIRMACIÓN FINAL ---
      const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('✅ Transferencia Exitosa')
        .setDescription(`De: ${sender}\nPara: ${receiver}\n\n${resultLog.join('\n')}`)
        .addFields({ name: '📝 Mensaje', value: `*${reason}*` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error en transfer:', err);
      await interaction.editReply('❌ Ocurrió un error inesperado durante la transferencia.');
    }
  }
};
