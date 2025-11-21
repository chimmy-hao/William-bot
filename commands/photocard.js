const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Conexión a Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN ---
const strawberryEmoji = '<:strawberrity:1411384728119939182>';

// Configuración visual por nivel de rareza
const rarityConfig = {
  1: { 
    display: `${strawberryEmoji}`, 
    name: 'Rareza 1', 
    color: '#95a5a6' 
  },
  2: { 
    display: `${strawberryEmoji}${strawberryEmoji}`, 
    name: 'Rareza 2', 
    color: '#3498db' 
  },
  3: { 
    display: `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`, 
    name: 'Rareza 3', 
    color: '#9b59b6' 
  }
};

// Cooldowns en memoria
const cooldowns = new Map();
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 minutos

// Generador de ID único
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('photocard')
    .setDescription('🎰 ¡Tira para obtener una photocard aleatoria! (Cooldown: 5 min)'),

  // LÍNEA IMPORTANTE PARA EL RESET
  cooldowns: cooldowns,

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();
    const lastUsed = cooldowns.get(userId) || 0;
    const remaining = COOLDOWN_TIME - (now - lastUsed);

    // 1. Verificar Cooldown
    if (remaining > 0) {
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      return interaction.reply({
        content: `⏳ Debes esperar **${minutes}m ${seconds}s** antes de volver a usar \`/photocard\`.`,
        ephemeral: true
      });
    }

    cooldowns.set(userId, now);

    try {
      await interaction.deferReply();

      // 2. Obtener cartas base
      const { data: baseCards, error: fetchError } = await supabase
        .from('base_cards')
        .select('*');

      if (fetchError || !baseCards || baseCards.length === 0) {
        console.error('Error base_cards:', fetchError);
        return interaction.editReply('❌ No hay cartas disponibles en la base de datos.');
      }

      // 3. Selección aleatoria
      const randomCard = baseCards[Math.floor(Math.random() * baseCards.length)];
      
      // Determinar nivel de rareza
      let level = randomCard.rarity_level || 1;
      if (!randomCard.rarity_level) {
         if (randomCard.rarity === 'rare') level = 2;
         if (randomCard.rarity === 'legendary') level = 3;
      }

      // 4. Generar ID único y Guardar
      const uniqueId = generateUniqueCardCode(randomCard.card_code);

      await supabase.from('users').upsert(
        { user_id: userId, username: interaction.user.username },
        { onConflict: 'user_id' }
      );

      const { error: insertError } = await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: randomCard.id,
        rarity: level,
        unique_card_id: uniqueId
      });

      if (insertError) throw insertError;

      // 5. Construir Embed
      const rConfig = rarityConfig[level];

      // === CORRECCIÓN DE NOMBRE (CLEAN NAME) ===
      // Cortamos en el guion " — " y tomamos solo la primera parte
      const cleanName = randomCard.name.split(' — ')[0].trim();

      const embed = new EmbedBuilder()
        .setColor(rConfig.color)
        .setTitle('✨ ¡Nueva Photocard Obtenida! ✨')
        .setDescription(
          `Artist: *${cleanName}* del grupo *${randomCard.group_name || 'Solista'}*\n` +
          `Era: *${randomCard.era || 'Desconocida'}*`
        )
        .addFields(
          { name: '🎴 ID de Carta', value: `\`${uniqueId}\``, inline: true },
          { name: '🍓 Rareza', value: `${rConfig.display} ${rConfig.name}`, inline: true },
          { name: '👤 Propietario', value: `<@${userId}>`, inline: true }
        )
        .setImage(randomCard.image_url)
        .setFooter({
          text: 'Usa /inventory para ver tu colección completa',
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error en /photocard:', error);
      cooldowns.delete(userId);
      await interaction.editReply('❌ Hubo un error al obtener tu carta. Intenta de nuevo.');
    }
  }
};
