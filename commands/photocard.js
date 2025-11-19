const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Supabase connection
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Emoji personalizado
const strawberryEmoji = '<:strawberrity:1411384728119939182>';

// Configuración de rarezas
const rarityConfig = {
  1: { stars: `${strawberryEmoji}`, name: 'Rareza 1', color: '#95a5a6' },
  2: { stars: `${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 2', color: '#3498db' },
  3: { stars: `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 3', color: '#9b59b6' }
};

// 🕒 Cooldowns en memoria
const cooldowns = new Map();
const COOLDOWN_TIME = 3 * 60 * 1000; // 3 minutos en ms

// Función para generar código único tipo WMO.1234
const generateUniqueCardCode = (baseCode) => `${baseCode}.${Math.floor(1000 + Math.random() * 9000)}`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('photocard')
    .setDescription('¡Obtén una photocard aleatoria para tu colección!'),

  async execute(interaction) {
    const userId = interaction.user.id;

    // Verificar cooldown
    const now = Date.now();
    const lastUsed = cooldowns.get(userId) || 0;
    const remaining = COOLDOWN_TIME - (now - lastUsed);

    if (remaining > 0) {
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);

      return interaction.reply({
        content: `⏳ Debes esperar **${minutes}m ${seconds}s** antes de volver a usar \`/photocard\`.`,
        ephemeral: true
      });
    }

    // Registrar nueva vez de uso
    cooldowns.set(userId, now);

    try {
      await interaction.deferReply();

      const { data: baseCards, error: fetchError } = await supabase
        .from('base_cards')
        .select('*');

      if (fetchError) {
        console.error('Error al buscar cartas base:', fetchError);
        throw new Error('Error al buscar cartas base');
      }

      if (!baseCards || baseCards.length === 0) {
        const noCardsEmbed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('❌ No hay cartas disponibles')
          .setDescription('¡Lo siento! No hay photocards disponibles en este momento. ¡Vuelve más tarde!')
          .setTimestamp();

        return await interaction.editReply({ embeds: [noCardsEmbed] });
      }

      const randomCard = baseCards[Math.floor(Math.random() * baseCards.length)];

      let selectedRarity = 1;
      if (randomCard.rarity === 'rare') selectedRarity = 2;
      else if (randomCard.rarity === 'legendary') selectedRarity = 3;

      // Generar un código único para cada usuario
      const uniqueCardId = generateUniqueCardCode(randomCard.card_code);

      await supabase.from('users').upsert(
        { user_id: userId, username: interaction.user.tag },
        { onConflict: 'user_id' }
      );

      const { error: insertError } = await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: randomCard.id,
        rarity: selectedRarity,
        unique_card_id: uniqueCardId
      });

      if (insertError) {
        console.error('Error al insertar carta:', insertError);
        throw new Error('Error al añadir carta a la colección');
      }

      const rarity = rarityConfig[selectedRarity];

      const successEmbed = new EmbedBuilder()
        .setColor(rarity.color)
        .setTitle('✨ ¡Nueva Photocard Obtenida! ✨')
        .setDescription(
          `*${randomCard.name}*` +
          `${randomCard.group_name ? ` — ${randomCard.group_name}` : ''}` +
          `${randomCard.era ? `\nEra: ${randomCard.era}` : ''}`
        )
        .addFields(
          { name: '🎴 ID de Carta', value: `\`${uniqueCardId}\``, inline: true },
          { name: '⭐ Rareza', value: `${rarity.stars} ${rarity.name}`, inline: true },
          { name: '👤 Propietario', value: `<@${userId}>`, inline: true }
        )
        .setImage(randomCard.image_url)
        .setFooter({
          text: `Usa /inventory para ver tu colección completa`,
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
    } catch (error) {
      console.error('Error en comando photocard:', error);

      const errorEmbed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle('❌ Error')
        .setDescription('Hubo un problema al obtener tu photocard. ¡Inténtalo de nuevo!')
        .setTimestamp();

      try {
        await interaction.editReply({ embeds: [errorEmbed] });
      } catch {
        await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  },
};
