const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- CONFIGURACIÓN ---
const COOLDOWN_TIME = 12 * 60 * 60 * 1000; // 12 Horas en milisegundos
const REWARD_AMOUNT = 2000;
const REWARD_RARITY = 2; // Nivel de rareza de la carta a regalar
const moneyEmoji = '<:berrycoin:1411737957081288724>';

// Cooldowns en memoria
const cooldowns = new Map();

// Función para generar código único
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('📅 Reclama tu recompensa diaria (Cada 12 horas)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();
    const lastUsed = cooldowns.get(userId) || 0;
    const remaining = COOLDOWN_TIME - (now - lastUsed);

    // 1. Verificar Cooldown
    if (remaining > 0) {
      // Cálculo de horas, minutos y segundos restantes
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      
      return interaction.reply({
        content: `⏳ Ya ayudaste a William hoy. Vuelve en **${hours}h ${minutes}m** para planear la próxima cita.`,
        ephemeral: true
      });
    }

    try {
      await interaction.deferReply();

      // 2. Obtener cartas de Rareza 2 (para regalar una)
      const { data: rareCards, error: cardError } = await supabase
        .from('base_cards')
        .select('*')
        .eq('rarity_level', REWARD_RARITY);

      if (cardError || !rareCards || rareCards.length === 0) {
        return interaction.editReply('❌ Error: No hay cartas de rareza 2 configuradas para dar de premio.');
      }

      // Elegir carta al azar
      const randomCard = rareCards[Math.floor(Math.random() * rareCards.length)];
      const uniqueCode = generateUniqueCardCode(randomCard.card_code);

      // 3. Actualizar Usuario (Monedas)
      // Primero verificamos si existe y traemos su balance actual
      let { data: userData } = await supabase
        .from('users')
        .select('balance')
        .eq('user_id', userId)
        .single();

      // Si no existe, lo creamos con balance 0 inicial
      if (!userData) {
        const { data: newUser } = await supabase
          .from('users')
          .insert({ user_id: userId, username: interaction.user.username, balance: 0 })
          .select()
          .single();
        userData = newUser;
      }

      const newBalance = (userData.balance || 0) + REWARD_AMOUNT;

      // Guardamos el nuevo balance
      await supabase
        .from('users')
        .update({ balance: newBalance })
        .eq('user_id', userId);

      // 4. Entregar la Carta
      await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: randomCard.id,
        rarity: randomCard.rarity_level,
        unique_card_id: uniqueCode
      });

      // 5. Registrar el cooldown
      cooldowns.set(userId, now);

      // 6. Enviar Respuesta con Imagen
      // Asegúrate de tener el archivo 'daily.gif' en la carpeta principal del bot
      const file = new AttachmentBuilder('./daily.gif');

      const embed = new EmbedBuilder()
        .setColor('#e84393') // Un color rosado/rojizo romántico
        .setTitle('📅 Recompensa Diaria')
        .setDescription(
          `Por ayudarlo a planear su cita con Est, William te otorga **${REWARD_AMOUNT}** ${moneyEmoji} y la carta \`${uniqueCode}\`.` +
          `\n\n🃏 **Carta recibida:** ${randomCard.name}`
        )
        .setImage('attachment://daily.gif') // Referencia al archivo adjunto
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [file] });

    } catch (error) {
      console.error('Error en daily:', error);
      await interaction.editReply('❌ Hubo un error al reclamar tu recompensa diaria.');
module.exports = {
  data: new SlashCommandBuilder()..., 
  cooldowns: cooldowns, // <--- ¡SIN ESTA LÍNEA EL RESET NO FUNCIONA!
  async execute(interaction) {
     // ...
  }
};
