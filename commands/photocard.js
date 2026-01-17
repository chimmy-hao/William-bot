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

// 1. CONFIGURACIÓN DE PROBABILIDADES
const EVENT_DROP_RATE = 15; // 15% de chance de que salga carta de Evento

const DROP_RATES = {
  1: 70, 
  2: 25, 
  3: 5   
};

// Configuración visual
const rarityConfig = {
  1: { display: `${strawberryEmoji}`, name: 'Rareza 1', color: '#95a5a6' },
  2: { display: `${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 2', color: '#3498db' },
  3: { display: `${strawberryEmoji}${strawberryEmoji}${strawberryEmoji}`, name: 'Rareza 3', color: '#9b59b6' },
  // Configuración especial para eventos (Opcional, usa el color que quieras)
  'event': { display: '✨', name: 'Evento Especial', color: '#E1306C' } 
};

// Generador de ID
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

// Función para determinar rareza (Solo para cartas normales)
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
      // 1. VERIFICACIÓN DE COOLDOWN
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
      // 2. LÓGICA DEL JUEGO (LÓGICA MAESTRA CON VERIFICACIÓN DE EVENTO)
      // ---------------------------------------------------------
      
      // A. Determinamos si es un Drop de Evento
      const isEventDrop = (Math.random() * 100) < EVENT_DROP_RATE;
      let finalPool = [];
      let searchingEvent = false;
      
      if (isEventDrop) {
          // 🔥 MODO EVENTO: Verificar eventos ACTIVOS
          const { data: activeEvents } = await supabase
              .from('events_config')
              .select('event_name')
              .eq('is_active', true);

          const activeEventList = activeEvents ? activeEvents.map(e => e.event_name) : [];

          if (activeEventList.length > 0) {
              searchingEvent = true;
              // Buscamos cartas de eventos activos
              const { data: eventCards } = await supabase
                  .from('base_cards')
                  .select('*')
                  .in('event_type', activeEventList)
                  .eq('is_active', true);
              
              if (eventCards && eventCards.length > 0) {
                  finalPool = eventCards;
              }
          }
      }

      // B. Fallback de Seguridad / Drop Normal
      // Si no era evento, o era evento pero no había activos/cartas, buscamos normales
      if (finalPool.length === 0) {
          if (isEventDrop && searchingEvent) console.log("⚠️ Intento de drop de evento fallido (sin cartas), usando fallback.");
          
          // MODO NORMAL: Buscamos por rareza y que NO sean de evento
          const targetRarity = rollRarity();
          const { data: normalCards } = await supabase
              .from('base_cards')
              .select('*')
              .eq('rarity_level', targetRarity)
              .is('event_type', null) // Excluir eventos
              .eq('is_active', true);
          
          finalPool = normalCards;
      }

      // Validación final
      if (!finalPool || finalPool.length === 0) {
        // Último intento: buscar cualquier carta normal activa
         const { data: backupCards } = await supabase
            .from('base_cards')
            .select('*')
            .is('event_type', null)
            .eq('is_active', true);
         finalPool = backupCards;

         if (!finalPool || finalPool.length === 0) {
             return interaction.editReply('❌ Error crítico: No hay cartas activas en la base de datos.');
         }
      }

      // C. Elegir carta aleatoria
      const randomCard = finalPool[Math.floor(Math.random() * finalPool.length)];
      const uniqueId = generateUniqueCardCode(randomCard.card_code);
      
      // Determinar nivel visual final
      const level = randomCard.rarity_level || 1;

      // ---------------------------------------------------------
      // 3. ACTUALIZAR DB + NOTIFICACIÓN + HISTORIAL
      // ---------------------------------------------------------
      await supabase.from('users').upsert(
        { 
            user_id: userId, 
            username: interaction.user.username,
            last_photocard_claim: now,
            photocard_notified: false 
        },
        { onConflict: 'user_id' }
      );

      const { error: insertError } = await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: randomCard.id,
        rarity: level,
        unique_card_id: uniqueId
      });

      if (insertError) throw insertError;

      // Historial
      const cleanNameLog = randomCard.name.split(' — ')[0].trim();
      const typeLog = randomCard.event_type ? `[${randomCard.event_type.toUpperCase()}]` : `Rareza ${level}`;
      
      await supabase.from('history_logs').insert({
          user_id: userId,
          action_type: 'drop',
          details: `Obtuvo ${cleanNameLog} (${uniqueId}) - ${typeLog}`
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
      
      // Personalizamos el mensaje si es Evento
      let rarityDisplay = `${rConfig.display} ${rConfig.name}`;
      let embedColor = rConfig.color;
      let titleText = '✨ ¡Nueva Photocard Obtenida! ✨';

      if (randomCard.event_type) {
          rarityDisplay = `🌟 Evento: ${randomCard.event_type.charAt(0).toUpperCase() + randomCard.event_type.slice(1)}`;
          embedColor = '#E1306C'; // Color especial para eventos
          titleText = '📸 ¡Carta de Evento Obtenida! 🎉';
      }

      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(titleText)
        .setDescription(
          `Artist: **${cleanName}**\nGrupo: **${randomCard.group_name || 'Solista'}**\nEra: *${randomCard.era || 'Original'}*`
        )
        .addFields(
          { name: '🎴 ID', value: `\`${uniqueId}\``, inline: true },
          { name: '🍓 Tipo', value: rarityDisplay, inline: true },
          { name: '👤 Dueño', value: `<@${userId}>`, inline: true }
        )
        .setFooter({
          text: `Creado por: ${creatorName}`,
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
      await interaction.editReply('❌ Hubo un error al obtener tu carta.');
    }
  }
};
