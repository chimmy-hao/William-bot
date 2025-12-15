const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas'); // Necesario para el borde

// Conexión a Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN ---
const strawberryEmoji = '<:strawberrity:1411384728119939182>';

// Probabilidades (Suman 100%)
const DROP_RATES = {
  1: 70, // 70% Probabilidad de Rareza 1
  2: 25, // 25% Probabilidad de Rareza 2
  3: 5   // 5%  Probabilidad de Rareza 3
};

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

// Función para determinar rareza basada en porcentajes
const rollRarity = () => {
  const roll = Math.random() * 100; // Número entre 0 y 100
  if (roll < DROP_RATES[1]) return 1; // 0 a 70
  if (roll < DROP_RATES[1] + DROP_RATES[2]) return 2; // 70 a 95
  return 3; // 95 a 100
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('photocard')
    .setDescription('🎰 ¡Tira para obtener una photocard aleatoria! (Cooldown: 5 min)'),

  // LÍNEA PARA EL RESET
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

      // 2. Determinar Rareza (RNG Ponderado)
      let targetRarity = rollRarity();

      // 3. Buscar cartas de esa rareza específica
      // Nota: Si por casualidad no hay cartas de rareza 3 en la DB, hacemos fallback a rareza 1
      let { data: candidateCards, error: fetchError } = await supabase
        .from('base_cards')
        .select('*')
        .eq('rarity_level', targetRarity);

      // Si falló o no hay cartas de esa rareza, buscamos cualquiera (fallback de seguridad)
      if (fetchError || !candidateCards || candidateCards.length === 0) {
        const { data: backupCards } = await supabase.from('base_cards').select('*');
        candidateCards = backupCards;
        if (!candidateCards || candidateCards.length === 0) {
            return interaction.editReply('❌ Error crítico: No hay cartas en la base de datos.');
        }
        // Recalcular rareza basada en la carta que salga del backup
        targetRarity = null; 
      }

      // 4. Elegir carta aleatoria del grupo filtrado
      const randomCard = candidateCards[Math.floor(Math.random() * candidateCards.length)];
      
      // Asegurar nivel de rareza correcto
      let level = targetRarity || randomCard.rarity_level || 1;
      // Fallback manual si rarity_level no estaba seteado en DB
      if (!randomCard.rarity_level && !targetRarity) {
         if (randomCard.rarity === 'rare') level = 2;
         if (randomCard.rarity === 'legendary') level = 3;
      }

      // 5. Generar ID único y Guardar
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

      // 6. PROCESAMIENTO DE IMAGEN (Canvas - Bordes Redondeados)
      let attachment = null;
      try {
        const img = await loadImage(randomCard.image_url);
        
        // Usamos el tamaño original para máxima calidad
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        
        // --- MEJORAS DE CALIDAD ---
        ctx.imageSmoothingEnabled = true;       // <--- Activa suavizado de bordes
        ctx.imageSmoothingQuality = 'high';     // <--- Fuerza la máxima calidad posible
        
        // --- CONFIGURACIÓN DEL BORDE ---
        const radius = 35; // <--- CAMBIA ESTE NÚMERO: Más alto = más redondo, Más bajo = más cuadrado.

        // Dibujar forma redondeada (Path)
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(img.width - radius, 0);
        ctx.quadraticCurveTo(img.width, 0, img.width, radius);
        ctx.lineTo(img.width, img.height - radius);
        ctx.quadraticCurveTo(img.width, img.height, img.width - radius, img.height);
        ctx.lineTo(radius, img.height);
        ctx.quadraticCurveTo(0, img.height, 0, img.height - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        
        ctx.clip(); // Recortar el canvas con la forma dibujada arriba

        ctx.drawImage(img, 0, 0);
        
        // Codificar en PNG (Formato sin pérdida de calidad)
        attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'drop.png' });
      } catch (err) {
        console.error('Error procesando imagen canvas:', err);
        // Si falla canvas, enviamos sin imagen o url directa en embed (fallback)
      }

      // 7. Construir Embed
      const rConfig = rarityConfig[level];
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
        .setFooter({
          text: 'Usa /inventory para ver tu colección completa',
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTimestamp();

      if (attachment) {
        embed.setImage('attachment://drop.png');
        await interaction.editReply({ embeds: [embed], files: [attachment] });
      } else {
        embed.setImage(randomCard.image_url); // Fallback si canvas falla
        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('Error en /photocard:', error);
      cooldowns.delete(userId);
      await interaction.editReply('❌ Hubo un error al obtener tu carta. Intenta de nuevo.');
    }
  }
};
