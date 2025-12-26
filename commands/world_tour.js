const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- CONFIGURACIÓN ---
const COOLDOWN_MINUTES = 15;
const COOLDOWN_TIME = COOLDOWN_MINUTES * 60 * 1000; 
const TOTAL_CONCERTS = 10; 

// Emojis
const moneyEmoji = '<:berrycoin:1411737957081288724>'; 
const bananaEmoji = '<:pack_banana:1413292531134759053>';
const grapeEmoji = '<:pack_grape:1413292369675157655>';

// Destinos de la Gira
const LOCATIONS = [
    { city: 'Seoul', country: 'Korea 🇰🇷' },
    { city: 'Buenos Aires', country: 'Argentina 🇦🇷' },
    { city: 'Tokyo', country: 'Japan 🇯🇵' },
    { city: 'Bangkok', country: 'Thailand 🇹🇭' },
    { city: 'Paris', country: 'France 🇫🇷' },
    { city: 'New York', country: 'USA 🇺🇸' },
    { city: 'London', country: 'UK 🇬🇧' },
    { city: 'Madrid', country: 'Spain 🇪🇸' },
    { city: 'Rio de Janeiro', country: 'Brazil 🇧🇷' },
    { city: 'Berlin', country: 'Germany 🇩🇪' },
    { city: 'Sydney', country: 'Australia 🇦🇺' },
    { city: 'Toronto', country: 'Canada 🇨🇦' },
    { city: 'Rome', country: 'Italy 🇮🇹' },
    { city: 'Mexico City', country: 'Mexico 🇲🇽' }
];

// GIFs de LYKN (Lista solicitada)
const LYKN_GIFS = [
    'https://media.tenor.com/2LpVedAVi88AAAAM/williamjkp-lykn-william.gif',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('world_tour')
    .setDescription('🎤 LYKN World Tour: Completa 10 conciertos para ganar premios.')
    .addSubcommand(sub => sub.setName('start').setDescription('Inicia la gira (Concierto 1)'))
    .addSubcommand(sub => sub.setName('next_concert').setDescription('Viaja al siguiente país (Cada 15 min)'))
    .addSubcommand(sub => sub.setName('goodbye').setDescription('Finaliza la gira y reclama recompensas (Al completar 10)')),

  async execute(interaction) {
    const userId = interaction.user.id;
    const subcommand = interaction.options.getSubcommand();
    const now = Date.now();

    try {
      await interaction.deferReply();

      // 1. Obtener datos básicos usuario
      const { data: user, error: userError } = await supabase.from('users').select('*').eq('user_id', userId).single();
      if (userError || !user) {
          // Si no existe, lo creamos rápido para que no de error
          await supabase.from('users').insert({ user_id: userId, username: interaction.user.username });
          return interaction.editReply('❌ Creando perfil... Intenta de nuevo en unos segundos.');
      }

      // 2. Obtener estado del tour
      let { data: tour } = await supabase.from('world_tours').select('*').eq('user_id', userId).single();

      // Helpers visuales
      const getGif = () => LYKN_GIFS[Math.floor(Math.random() * LYKN_GIFS.length)];
      const getDest = () => LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];

      // ==================================================================
      // 🎤 START (Concierto 1)
      // ==================================================================
      if (subcommand === 'start') {
          if (tour) {
              return interaction.editReply(`⚠️ **Gira en curso:** Estás en el concierto **${tour.current_city}/${TOTAL_CONCERTS}**. Usa \`/world_tour next_concert\`.`);
          }

          // Recompensa inicial (100-300 monedas)
          const pay = Math.floor(Math.random() * 201) + 100;
          const dest = getDest();

          // Crear tour iniciando en 1
          await supabase.from('world_tours').insert({ user_id: userId, current_city: 1, last_checkin: now });
          
          // Dar dinero
          await supabase.from('users').update({ balance: (user.balance || 0) + pay }).eq('user_id', userId);

          const embed = new EmbedBuilder()
              .setColor('#FF0055') 
              .setTitle(`🎤 LYKN World Tour: START!`)
              .setDescription(
                  `¡La gira ha comenzado! LYKN acaba de aterrizar en **${dest.city} - ${dest.country}**.\n` +
                  `El primer concierto fue un éxito total.\n\n` +
                  `💰 **Ganancia:** +${pay} ${moneyEmoji}\n` +
                  `📊 **Progreso:** Concierto 1/${TOTAL_CONCERTS}\n` +
                  `⏰ **Próximo:** En ${COOLDOWN_MINUTES} minutos usa \`/world_tour next_concert\`.`
              )
              .setImage(getGif());

          return interaction.editReply({ embeds: [embed] });
      }

      // ==================================================================
      // ✈️ NEXT CONCERT (2 al 10)
      // ==================================================================
      if (subcommand === 'next_concert') {
          if (!tour) return interaction.editReply('❌ No has iniciado la gira. Usa `/world_tour start`.');
          
          // Si ya llegó a 10, lo mandamos al goodbye
          if (tour.current_city >= TOTAL_CONCERTS) {
              return interaction.editReply('🎉 **¡Gira Finalizada!** Ya diste los 10 conciertos. Usa `/world_tour goodbye` para despedirte y cobrar.');
          }

          // Verificar Cooldown (15 min)
          const remaining = COOLDOWN_TIME - (now - tour.last_checkin);
          if (remaining > 0) {
              const minutes = Math.floor(remaining / 60000);
              const seconds = Math.floor((remaining % 60000) / 1000);
              return interaction.editReply(`⏳ **Descansando en el hotel.**\nLYKN debe descansar. Próximo vuelo en **${minutes}m ${seconds}s**.`);
          }

          // Avanzar contador
          const nextStep = tour.current_city + 1;
          const pay = Math.floor(Math.random() * 201) + 100;
          const dest = getDest();

          // Actualizar DB
          await supabase.from('world_tours').update({ current_city: nextStep, last_checkin: now }).eq('user_id', userId);
          await supabase.from('users').update({ balance: (user.balance || 0) + pay }).eq('user_id', userId);

          const embed = new EmbedBuilder()
              .setColor('#9B59B6')
              .setTitle(`✈️ Next Stop: ${dest.city} ${dest.country}`)
              .setDescription(
                  `El avión ha aterrizado y el estadio está lleno.\n` +
                  `¡Qué energía increíble en **${dest.city}**!\n\n` +
                  `💰 **Ganancia:** +${pay} ${moneyEmoji}\n` +
                  `📊 **Progreso:** Concierto ${nextStep}/${TOTAL_CONCERTS}`
              )
              .setImage(getGif())
              .setFooter({ text: nextStep === TOTAL_CONCERTS ? '¡Último concierto! Usa /world_tour goodbye' : `Descanso de ${COOLDOWN_MINUTES} min.` });

          return interaction.editReply({ embeds: [embed] });
      }

      // ==================================================================
      // 👋 GOODBYE (Reclamo Final)
      // ==================================================================
      if (subcommand === 'goodbye') {
          if (!tour || tour.current_city < TOTAL_CONCERTS) {
              return interaction.editReply(`❌ Aún no terminas la gira. Vas por el concierto **${tour ? tour.current_city : 0}/${TOTAL_CONCERTS}**.`);
          }

          // Sin cooldown. Si ya llegó a 10, cobra.

          // Recompensas Finales
          const finalCoins = 3000;
          const packs = [
              { id: 'banana', name: 'Banana Pack', emoji: bananaEmoji },
              { id: 'grape', name: 'Grape Pack', emoji: grapeEmoji }
          ];

          // 1. Dar Dinero
          await supabase.from('users').update({ balance: (user.balance || 0) + finalCoins }).eq('user_id', userId);

          // 2. Dar Packs (Inventario)
          for (const p of packs) {
              // Buscar si ya tiene el pack
              const { data: inv } = await supabase
                .from('user_inventory')
                .select('quantity')
                .eq('user_id', userId)
                .eq('item_id', p.id)
                .single();
              
              const qty = (inv?.quantity || 0) + 1;
              
              // Upsert (Insertar o Actualizar)
              await supabase.from('user_inventory').upsert(
                { user_id: userId, item_id: p.id, quantity: qty }, 
                { onConflict: 'user_id, item_id' }
              );
          }

          // 3. Borrar Tour (Reset para jugar de nuevo)
          await supabase.from('world_tours').delete().eq('user_id', userId);

          const embed = new EmbedBuilder()
              .setColor('#FFD700') // Dorado
              .setTitle('👋 LYKN World Tour: Goodbye Stage')
              .setDescription(
                  `¡Gracias a todos los fans! La gira mundial ha concluido con éxito.\n` +
                  `LYKN regresa a casa para descansar.\n\n` +
                  `**🎁 Recompensas Finales:**\n` +
                  `💰 **${finalCoins}** ${moneyEmoji}\n` +
                  `+1 ${packs[0].emoji} **${packs[0].name}**\n` +
                  `+1 ${packs[1].emoji} **${packs[1].name}**`
              )
              .setImage(getGif())
              .setFooter({ text: 'Puedes iniciar una nueva gira cuando quieras con /world_tour start' });

          return interaction.editReply({ embeds: [embed] });
      }

    } catch (err) {
      console.error('Error en world_tour:', err);
      interaction.editReply('❌ Ocurrió un error inesperado en la gira.');
    }
  }
};
