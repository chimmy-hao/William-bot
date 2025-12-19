const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas'); 

// Conexión a Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN ---
const strawberryEmoji = '<:strawberrity:1411384728119939182>';
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 minutos

// Probabilidades (Suman 100%)
const DROP_RATES = {
  1: 70, 
  2: 25, 
  3: 5   
};

// Configuración visual por nivel de rareza
const rarityConfig = {
  1: { display: `${strawberryEmoji}`, name: 'Rareza 1', color: '#95a5a6' },
  2: { display: `${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 2', color: '#3498db' },
  3: { display: `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 3', color: '#9b59b6' }
};

// Generador de ID único
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

// Función para determinar rareza
const rollRarity = () => {
  const roll = Math.random() * 100;
  if (roll < DROP_RATES[1]) return 1;
  if (roll < DROP_RATES[1] + DROP_RATES[2]) return 2;
  return 3; 
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('photocard')
    .setDescription('🎰 ¡Tira para obtener una photocard aleatoria! (Cooldown: 5 min)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    try {
      // ---------------------------------------------------------
      // 1. VERIFICACIÓN DE COOLDOWN (BASE DE DATOS)
      // ---------------------------------------------------------
      
      let { data: userCheck } = await supabase
        .from('users')
        .select('last_photocard_claim')
        .eq('user_id', userId)
        .single();
      
      const lastUsed = userCheck?.last_photocard_claim || 0;
      const remaining = COOLDOWN_TIME - (now - lastUsed);

      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        return interaction.reply({
          content: `⏳ Debes esperar **${minutes}m ${seconds}s** antes de volver a usar \`/photocard\`.`,
          ephemeral: true
        });
      }

      await interaction.deferReply();

      // ---------------------------------------------------------
      // 2. LÓGICA DEL JUEGO
      // ---------------------------------------------------------

      // Determinar Rareza
      let targetRarity = rollRarity();

      // Buscar cartas
      let { data: candidateCards, error: fetchError } = await supabase
        .from('base_cards')
        .select('*')
        .eq('rarity_level', targetRarity);

      // Fallback si no hay cartas de esa rareza
      if (fetchError || !candidateCards || candidateCards.length === 0) {
        const { data: backupCards } = await supabase.from('base_cards').select('*');
        candidateCards = backupCards;
        if (!candidateCards || candidateCards.length === 0) {
            return interaction.editReply('❌ Error crítico: No hay cartas en la base de datos.');
        }
        targetRarity = null; 
      }

      // Elegir carta aleatoria
      const randomCard = candidateCards[Math.floor(Math.random() * candidateCards.length)];
      
      let level = targetRarity || randomCard.rarity_level || 1;
      if (!randomCard.rarity_level && !targetRarity) {
         if (randomCard.rarity === 'rare') level = 2;
         if (randomCard.rarity === 'legendary') level = 3;
      }

      const uniqueId = generateUniqueCardCode(randomCard.card_code);

      // ---------------------------------------------------------
      // 3. ACTUALIZAR DB + NOTIFICACIÓN + HISTORIAL
      // ---------------------------------------------------------

      // Actualizamos usuario, tiempo Y ACTIVAMOS NOTIFICACIÓN
      await supabase.from('users').upsert(
        { 
            user_id: userId, 
            username: interaction.user.username,
            last_photocard_claim: now,
            photocard_notified: false // <--- 🔔 Recordatorio activado
        },
        { onConflict: 'user_id' }
      );

      // Guardamos la carta
      const { error: insertError } = await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: randomCard.id,
        rarity: level,
        unique_card_id: uniqueId
      });

      if (insertError) throw insertError;

      // 📜 GUARDAR EN HISTORIAL
      const cleanNameLog = randomCard.name.split(' — ')[0].trim();
      await supabase.from('history_logs').insert({
          user_id: userId,
          action_type: 'drop',
          details: `Obtuvo ${cleanNameLog} (${uniqueId}) de Rareza ${level}`
      });

      // ---------------------------------------------------------
      // 4. PROCESAMIENTO DE IMAGEN (CANVAS)
      // ---------------------------------------------------------
      let attachment = null;
      try {
        const img = await loadImage(randomCard.image_url);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        
        ctx.imageSmoothingEnabled = true;       
        ctx.imageSmoothingQuality = 'high';     
        
        const radius = 50; 

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
        
        ctx.clip(); 
        ctx.drawImage(img, 0, 0);
        
        attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'drop.png' });
      } catch (err) {
        console.error('Error procesando imagen canvas:', err);
      }

      // ---------------------------------------------------------
      // 5. EMBED FINAL
      // ---------------------------------------------------------
      const rConfig = rarityConfig[level];
      const cleanName = randomCard.name.split(' — ')[0].trim();
      
      const creatorName = randomCard.creator ? `@${randomCard.creator}` : 'William System';

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
          text: `Creado por: ${creatorName}\nUsa /inventory para ver tu colección completa`,
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTimestamp();

      if (attachment) {
        embed.setImage('attachment://drop.png');
        await interaction.editReply({ embeds: [embed], files: [attachment] });
      } else {
        embed.setImage(randomCard.image_url);
        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('Error en /photocard:', error);
      await interaction.editReply('❌ Hubo un error al obtener tu carta. Intenta de nuevo.');
    }
  }
};
