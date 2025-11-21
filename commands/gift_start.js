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

// Función para generar ID único de carta (si regalas cartas)
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
    
    // Autocompletado de Packs (Lista de todos los packs disponibles en el sistema)
    if (focused.name === 'pack') {
      const { data: packs } = await supabase.from('packs').select('code, name');
      if (!packs) return interaction.respond([]);

      // Mostramos solo el nombre limpio, sin emojis
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

    // 3. VALIDAR QUE SOLO HAYA UN TIPO DE REGALO
    // Contamos cuántos tipos de regalo seleccionó (true = 1, false = 0)
    const selections = [!!moneyAmount, !!packCode, giveCard].filter(Boolean).length;

    if (selections === 0) {
      return interaction.reply({ content: '⚠️ Debes elegir al menos UN premio (Dinero, Pack o Carta).', ephemeral: true });
    }
    if (selections > 1) {
      return interaction.reply({ content: '⚠️ Por favor, elige solo UN tipo de premio a la vez para no confundir el sistema.', ephemeral: true });
    }

    await interaction.deferReply();

    // Preparar textos y datos del premio
    let rewardText = '';
    let packData = null;

    if (moneyAmount) {
      rewardText = `**${moneyAmount}** ${moneyEmoji}`;
    } else if (packCode) {
      const { data: pack } = await supabase.from('packs').select('*').eq('code', packCode).single();
      if (!pack) return interaction.editReply('❌ Error: El pack seleccionado no existe en la base de datos.');
      packData = pack;
      rewardText = `un **${pack.name}** ${pack.emoji || '📦'}`;
    } else if (giveCard) {
      rewardText = `una **Carta Especial (Rareza 2)** 🃏`;
    }

    // Calcular tiempo final (Timestamp de Discord)
    const endTime = Date.now() + durationMs;
    const expiryTimestamp = Math.floor(endTime / 1000); // Segundos para Discord

    // 4. CREAR EMBED INICIAL
    const giftEmbed = new EmbedBuilder()
      .setColor('#2ecc71') // Verde estilo "Gift"
      .setTitle('🎁 ¡Nuevo Regalo Disponible!')
      .setDescription(
        `**${interaction.user.username}** ha iniciado un regalo para todos.\n\n` +
        `Haz clic en el botón de abajo para reclamar:\n` +
        `👉 Recibirás ${rewardText}\n\n` +
        `⏳ Expira: <t:${expiryTimestamp}:R>` // Contador relativo de Discord
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

    // 5. SISTEMA DE RECLAMO (COLLECTOR)
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: durationMs
    });

    // Set para guardar quiénes ya reclamaron en ESTA sesión
    const claimedUsers = new Set();

    collector.on('collect', async i => {
      if (i.customId === 'claim_gift') {
        // Verificar si ya reclamó
        if (claimedUsers.has(i.user.id)) {
          return i.reply({ content: '❌ Ya reclamaste este regalo.', ephemeral: true });
        }

        try {
          // --- ENTREGAR PREMIO ---
          
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
              { onConflict: ['user_id', 'pack_code'] }
            );
          }

          // C) CARTA
          if (giveCard) {
            // Buscar carta random R2
            const { data: cards } = await supabase.from('base_cards').select('id, card_code').eq('rarity_level', 2);
            if (cards && cards.length > 0) {
              const randomCard = cards[Math.floor(Math.random() * cards.length)];
              const uniqueId = generateUniqueCardCode(randomCard.card_code);
              
              // Asegurar usuario existe antes de meter carta
              await supabase.from('users').upsert({ user_id: i.user.id, username: i.user.username });
              
              await supabase.from('user_cards').insert({
                user_id: i.user.id,
                card_id: randomCard.id,
                rarity: 2,
                unique_card_id: uniqueId
              });
            }
          }

          // Marcar como reclamado
          claimedUsers.add(i.user.id);

          // Respuesta Epímera al usuario
          await i.reply({ content: `✅ ¡Has reclamado ${rewardText}!`, ephemeral: true });

          // Actualizar contador en el mensaje original
          const newEmbed = EmbedBuilder.from(giftEmbed)
            .setFooter({ text: `Total reclamados: ${claimedUsers.size}` });
          
          await message.edit({ embeds: [newEmbed] });

        } catch (err) {
          console.error('Error claiming gift:', err);
          await i.reply({ content: '❌ Hubo un error al procesar tu regalo. Intenta de nuevo.', ephemeral: true });
        }
      }
    });

    collector.on('end', () => {
      // Desactivar botón cuando termine el tiempo
      const disabledRow = new ActionRowBuilder().addComponents(
        ButtonBuilder.from(row.components[0]).setDisabled(true).setLabel('Expirado').setStyle(ButtonStyle.Secondary)
      );
      
      const finalEmbed = EmbedBuilder.from(giftEmbed)
        .setDescription(`🎁 **Este regalo ha finalizado.**\nGracias a los **${claimedUsers.size}** usuarios que participaron.`)
        .setColor('#95a5a6'); // Gris

      message.edit({ embeds: [finalEmbed], components: [disabledRow] }).catch(() => {});
    });
  }
};
