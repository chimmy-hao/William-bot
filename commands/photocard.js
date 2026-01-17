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
const EVENT_DROP_RATE = 15; // 15% chance de Evento

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
  'event': { display: '✨', name: 'Evento Especial', color: '#E1306C' } 
};

// Generador de ID
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

// Función simple para rareza
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
      // 1. COOLDOWN
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
      // 2. OBTENCIÓN DE CARTAS (ESTRATEGIA BLINDADA "TODO EN UNO")
      // ---------------------------------------------------------
      
      // A. Bajamos TODAS las cartas activas y la configuración de eventos
      const [cardsResult, eventsResult] = await Promise.all([
          supabase.from('base_cards').select('*').eq('is_active', true),
          supabase.from('events_config').select('event_name').eq('is_active', true)
      ]);

      const allCards = cardsResult.data;
      const activeEvents = eventsResult.data ? eventsResult.data.map(e => e.event_name) : [];

      if (!allCards || allCards.length === 0) {
          return interaction.editReply('❌ **Error Crítico:** No hay cartas activas en el sistema.');
      }

      // B. Clasificación en Memoria (JavaScript)
      const poolEvents = [];
      const poolNormal = {
          1: [],
          2: [],
          3: []
      };

      allCards.forEach(card => {
          // Chequeamos si es evento (tiene texto en event_type)
          if (card.event_type && card.event_type.trim() !== "") {
              // Solo entra al pool si el evento está ACTIVO
              if (activeEvents.includes(card.event_type)) {
                  poolEvents.push(card);
              }
          } else {
              // Es Normal: Clasificar por rareza
              const r = card.rarity_level || 1; 
              if (poolNormal[r]) {
                  poolNormal[r].push(card);
              } else {
                  // Por si tienes rareza 4 o algo raro, lo metemos en 1 por defecto
                  poolNormal[1].push(card); 
              }
          }
      });

      // ---------------------------------------------------------
      // 3. LÓGICA DE DROP (TIRADA DE DADOS)
      // ---------------------------------------------------------
      
      let finalPool = [];
      const isEventRoll = (Math.random() * 100) < EVENT_DROP_RATE;
      let selectedRarity = 1; // Default
      let isEventCard = false;

      // INTENTO A: Drop de Evento
      if (isEventRoll && poolEvents.length > 0) {
          finalPool = poolEvents;
          isEventCard = true;
      } 
      
      // INTENTO B: Drop Normal (Si no salió evento, o no había cartas de evento)
      if (finalPool.length === 0) {
          isEventCard = false;
          selectedRarity = rollRarity(); // 1, 2 o 3

          // Intentamos usar el pool de la rareza que salió
          if (poolNormal[selectedRarity] && poolNormal[selectedRarity].length > 0) {
              finalPool = poolNormal[selectedRarity];
          } else {
              // FALLBACK 1: Si salió Rareza 3 pero no hay, busca Rareza 2, luego 1
              // Juntamos todas las normales disponibles
              const allNormals = [...poolNormal[1], ...poolNormal[2], ...poolNormal[3]];
              if (allNormals.length > 0) {
                  finalPool = allNormals;
                  // console.log("⚠️ Fallback activado: Usando cualquier normal disponible.");
              }
          }
      }

      // FALLBACK NUCLEAR: Si no hay normales, usa eventos (y viceversa) -> CUALQUIER CARTA
      if (finalPool.length === 0) {
          finalPool = allCards;
      }

      // 4. SELECCIÓN FINAL
      const randomCard = finalPool[Math.floor(Math.random() * finalPool.length)];
      const uniqueId = generateUniqueCardCode(randomCard.card_code);
      
      // Definimos la estética final
      // Si salió de la bolsa de eventos, forzamos que se vea como evento
      if (poolEvents.includes(randomCard)) isEventCard = true; 
      
      // Nivel visual
      const level = randomCard.rarity_level || 1;

      // ---------------------------------------------------------
      // 5. GUARDADO EN BASE DE DATOS
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
      const typeLog = isEventCard ? `[EVENT: ${randomCard.event_type}]` : `Rareza ${level}`;
      
      await supabase.from('history_logs').insert({
          user_id: userId,
          action_type: 'drop',
          details: `Obtuvo ${cleanNameLog} (${uniqueId}) - ${typeLog}`
      });

      // ---------------------------------------------------------
      // 6. GENERACIÓN DE IMAGEN (CANVAS) Y EMBED
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
        console.error('Error canvas:', err);
      }

      // Configuración del Embed
      const rConfig = rarityConfig[level];
      const cleanName = randomCard.name.split(' — ')[0].trim();
      const creatorName = randomCard.creator ? `@${randomCard.creator}` : 'William System';
      
      let rarityDisplay = `${rConfig.display} ${rConfig.name}`;
      let embedColor = rConfig.color;
      let titleText = '✨ ¡Nueva Photocard Obtenida! ✨';

      if (isEventCard) {
          const eventName = randomCard.event_type ? randomCard.event_type.charAt(0).toUpperCase() + randomCard.event_type.slice(1) : 'Especial';
          rarityDisplay = `🌟 Evento: ${eventName}`;
          embedColor = '#E1306C'; 
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
      await interaction.editReply('❌ Hubo un error al obtener tu carta. (Revisa consola)');
    }
  }
};
