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

// --- CONFIGURACIÓN ---
const MANAGER_ROLE_ID = '1412852141197885464';
const moneyEmoji = '<:berrycoin:1411737957081288724>'; 

const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('🎁 ADMIN: Crea un regalo temporal para todos los usuarios')
    .addStringOption(opt =>
      opt.setName('duration')
        .setDescription('¿Cuánto tiempo durará el regalo?')
        .setRequired(true)
        .addChoices(
          { name: '1 minuto', value: '60000' },
          { name: '30 minutos', value: '1800000' },
          { name: '1 hora', value: '3600000' },
          { name: '6 horas', value: '21600000' },
          { name: '12 horas', value: '43200000' }
        )
    )
    .addIntegerOption(opt =>
      opt.setName('money')
        .setDescription('Cantidad de monedas a regalar (Max 10,000)')
        .setMinValue(1)
        .setMaxValue(10000)
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('pack')
        .setDescription('Elige un pack para regalar')
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('cards')
        .setDescription('¿Regalar una carta aleatoria (Rareza 2)?')
        .setRequired(false)
        .addChoices(
          { name: 'Sí (Carta Aleatoria Rareza 2)', value: 'yes' },
          { name: 'No', value: 'no' }
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    
    if (focused.name === 'pack') {
      const { data: packs } = await supabase.from('packs').select('code, name');
      if (!packs) return interaction.respond([]);

      const filtered = packs
        .filter(p => p.name.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25);
        
      return interaction.respond(filtered.map(p => ({ name: p.name, value: p.code })));
    }
  },

  async execute(interaction) {
    // 1. VERIFICACIÓN DE ROL
    if (!interaction.member.roles.cache.has(MANAGER_ROLE_ID)) {
      return interaction.reply({ content: '🚫 No tienes permisos para crear regalos.', ephemeral: true });
    }

    // 2. OBTENER OPCIONES
    const durationMs = parseInt(interaction.options.getString('duration'));
    const moneyAmount = interaction.options.getInteger('money');
    const packCode = interaction.options.getString('pack');
    const giveCard = interaction.options.getString('cards') === 'yes';

    const selections = [!!moneyAmount, !!packCode, giveCard].filter(Boolean).length;

    if (selections === 0) return interaction.reply({ content: '⚠️ Debes elegir al menos UN premio.', ephemeral: true });
    if (selections > 1) return interaction.reply({ content: '⚠️ Elige solo UN tipo de premio a la vez.', ephemeral: true });

    await interaction.deferReply();

    let rewardText = '';
    let packData = null;

    if (moneyAmount) {
      rewardText = `**${moneyAmount}** ${moneyEmoji}`;
    } else if (packCode) {
      const { data: pack } = await supabase.from('packs').select('*').eq('code', packCode).single();
      if (!pack) return interaction.editReply('❌ Error: El pack seleccionado no existe.');
      packData = pack;
      rewardText = `un **${pack.name}** ${pack.emoji || '📦'}`;
    } else if (giveCard) {
      rewardText = `una **Carta Especial (Rareza 2)** 🃏`;
    }

    const endTime = Date.now() + durationMs;
    const expiryTimestamp = Math.floor(endTime / 1000); 

    const giftEmbed = new EmbedBuilder()
      .setColor('#2ecc71') 
      .setTitle('🎁 ¡Nuevo Regalo Disponible!')
      .setDescription(
        `**${interaction.user.username}** ha iniciado un regalo para todos.\n\n` +
        `Haz clic en el botón de abajo para reclamar:\n` +
        `👉 Recibirás ${rewardText}\n\n` +
        `⏳ Expira: <t:${expiryTimestamp}:R>` 
      )
      .setFooter({ text: 'Total reclamados: 0' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('claim_gift')
        .setLabel('Reclamar Regalo')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎁')
    );

    const message = await interaction.editReply({ embeds: [giftEmbed], components: [row] });

    // 5. SISTEMA DE RECLAMO
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: durationMs
    });

    const claimedUsers = new Set();

    collector.on('collect', async i => {
      if (i.customId === 'claim_gift') {
        if (claimedUsers.has(i.user.id)) return i.reply({ content: '❌ Ya reclamaste este regalo.', ephemeral: true });

        try {
          let actualPrizeString = rewardText; // Para mensaje personal

          // A) DINERO
          if (moneyAmount) {
            const { data: user } = await supabase.from('users').select('balance').eq('user_id', i.user.id).single();
            const currentBal = user ? user.balance : 0;
            
            await supabase.from('users').upsert({ 
              user_id: i.user.id, 
              username: i.user.username, 
              balance: currentBal + moneyAmount 
            });
          }

          // B) PACK
          if (packData) {
            const { data: up } = await supabase.from('user_packs').select('quantity').eq('user_id', i.user.id).eq('pack_code', packData.code).single();
            const newQty = (up ? up.quantity : 0) + 1;
            
            await supabase.from('user_packs').upsert(
              { user_id: i.user.id, pack_code: packData.code, quantity: newQty },
              { onConflict: 'user_id, pack_code' }
            );
          }

          // C) CARTA (Corrección para mostrar nombre)
          if (giveCard) {
            const { data: cards } = await supabase.from('base_cards').select('id, card_code, name, group_name').eq('rarity_level', 2);
            if (cards && cards.length > 0) {
              const randomCard = cards[Math.floor(Math.random() * cards.length)];
              const uniqueId = generateUniqueCardCode(randomCard.card_code);
              
              await supabase.from('users').upsert({ user_id: i.user.id, username: i.user.username });
              
              await supabase.from('user_cards').insert({
                user_id: i.user.id,
                card_id: randomCard.id,
                rarity: 2,
                unique_card_id: uniqueId
              });
              
              // Actualizamos el string para decirle qué carta ganó
              actualPrizeString = `una carta: **${randomCard.name}** (${randomCard.group_name})`;
            }
          }

          claimedUsers.add(i.user.id);
          await i.reply({ content: `✅ ¡Has reclamado ${actualPrizeString}!`, ephemeral: true });

          const newEmbed = EmbedBuilder.from(giftEmbed)
            .setFooter({ text: `Total reclamados: ${claimedUsers.size}` });
          
          await message.edit({ embeds: [newEmbed] });

        } catch (err) {
          console.error('Error claiming gift:', err);
          await i.reply({ content: '❌ Hubo un error al procesar tu regalo.', ephemeral: true });
        }
      }
    });

    collector.on('end', () => {
      const disabledRow = new ActionRowBuilder().addComponents(
        ButtonBuilder.from(row.components[0]).setDisabled(true).setLabel('Expirado').setStyle(ButtonStyle.Secondary)
      );
      
      const finalEmbed = EmbedBuilder.from(giftEmbed)
        .setDescription(`🎁 **Este regalo ha finalizado.**\nGracias a los **${claimedUsers.size}** usuarios que participaron.`)
        .setColor('#95a5a6'); 

      message.edit({ embeds: [finalEmbed], components: [disabledRow] }).catch(() => {});
    });
  }
};
