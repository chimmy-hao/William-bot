const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- CONFIGURACIÓN ---
const SUCCESS_RATE = 0.30; // 30% de Probabilidad de éxito (Cambia a 0.20 si quieres que sea más difícil)
const MAX_USES = 3;        // 3 intentos
const COOLDOWN_TIME = 24 * 60 * 60 * 1000; // 24 Horas

// Sistema de Cooldown en memoria
const cooldowns = new Map();

// Función auxiliar para generar ID único
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alpha')
    .setDescription('🐺 Project Alpha: Arriesga una carta para evolucionarla (30% Éxito / 70% Pierdes).')
    .addStringOption(option => 
      option.setName('code')
        .setDescription('El código de la carta que quieres enviar a competir')
        .setRequired(true)
    ),

async execute(interaction) {
    const userId = interaction.user.id;
    const botId = '1411218644163231804'; // <--- Aquí pusimos tu ID fijo
    const codeInput = interaction.options.getString('code').trim();

    // 1. GESTIÓN DE COOLDOWN (Igual que Licuadora)
    const now = Date.now();
    let userData = cooldowns.get(userId) || { uses: 0, expiresAt: 0 };

    // Si ya gastó sus usos
    if (userData.uses >= MAX_USES) {
      if (now < userData.expiresAt) {
        const remaining = userData.expiresAt - now;
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        
        return interaction.reply({ 
          content: `⏳ **Project Alpha cerrado por hoy.**\nHas agotado tus 3 intentos. Vuelve en **${hours}h ${mins}m**.`, 
          ephemeral: true 
        });
      } else {
        // El tiempo pasó, reseteamos
        userData = { uses: 0, expiresAt: 0 };
      }
    }

    await interaction.deferReply();

    try {
      // 2. VERIFICAR QUE LA CARTA EXISTA Y SEA DEL USUARIO
      const { data: cardData, error } = await supabase
        .from('user_cards')
        .select('*, base_cards(*)')
        .eq('unique_card_id', codeInput)
        .eq('user_id', userId)
        .single();

      if (error || !cardData) {
        return interaction.editReply('❌ No encontré esa carta o no te pertenece. Revisa el código.');
      }

      const currentRarity = cardData.rarity;

      // 3. VALIDAR QUE NO SEA YA RAREZA MÁXIMA (3)
      if (currentRarity >= 3) {
        return interaction.editReply('👑 ¡Esta carta ya es un verdadero **Alpha** (Rareza 3)! No puede ascender más.');
      }

      // 4. TRANSFERIR CARTA AL BOT (El sacrificio ocurre SIEMPRE)
      // Antes de tirar los dados, la carta ya pasa a ser propiedad de William
      const { error: moveError } = await supabase
        .from('user_cards')
        .update({ user_id: botId }) 
        .eq('id', cardData.id);

      if (moveError) {
        return interaction.editReply('❌ Error al procesar el sacrificio de la carta.');
      }

      // 5. LA MECÁNICA DE RIESGO (30% Éxito vs 70% Fallo)
      const isSuccess = Math.random() < SUCCESS_RATE; 

      // CASO A: FRACASO (ELIMINACIÓN) ❌
      if (!isSuccess) {
        // Actualizamos cooldown (gastó un intento)
        userData.uses += 1;
        if (userData.uses >= MAX_USES) userData.expiresAt = now + COOLDOWN_TIME;
        cooldowns.set(userId, userData);

        const embedFail = new EmbedBuilder()
          .setColor('#2b2b2b') // Gris oscuro (Derrota)
          .setTitle('🐺❌ Eliminado de la Manada')
          .setDescription(
            `La carta **${cardData.base_cards.name}** no superó la prueba.\n` +
            `Ha sido reclamada por William Bot.`
          )
          .addFields({ name: 'Intentos Restantes', value: `${MAX_USES - userData.uses}/${MAX_USES}` })
          .setFooter({ text: 'Better luck next time...' });

        return interaction.editReply({ embeds: [embedFail] });
      }

      // CASO B: ÉXITO (ASCENSO ALPHA) 🐺🌕
      
      const nextRarity = currentRarity + 1;
      
      // Buscamos carta de nivel superior
      const { data: possibleUpgrades } = await supabase
        .from('base_cards')
        .select('*')
        .eq('rarity_level', nextRarity);

      if (!possibleUpgrades || possibleUpgrades.length === 0) {
        return interaction.editReply('⚠️ ¡Has ganado! Pero hubo un error buscando la carta de premio en la base de datos.');
      }

      const newCardBase = possibleUpgrades[Math.floor(Math.random() * possibleUpgrades.length)];
      const newUniqueId = generateUniqueCardCode(newCardBase.card_code);

      // Insertamos la nueva carta mejorada al usuario
      await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: newCardBase.id,
        rarity: nextRarity,
        unique_card_id: newUniqueId
      });

      // Actualizamos cooldown también en caso de éxito
      userData.uses += 1;
      if (userData.uses >= MAX_USES) userData.expiresAt = now + COOLDOWN_TIME;
      cooldowns.set(userId, userData);

      const embedSuccess = new EmbedBuilder()
        .setColor('#5865F2') // Azul Alpha
        .setTitle('🐺🌕 ¡Ascenso Alpha Exitoso!')
        .setDescription(`¡Un aullido de victoria! Tu carta ha evolucionado.`)
        .addFields(
          { name: 'Sacrificio', value: `~~${cardData.base_cards.name}~~ (R${currentRarity})`, inline: true },
          { name: 'Nueva Alpha', value: `**${newCardBase.name}** (R${nextRarity})`, inline: true },
          { name: 'Código', value: `\`${newUniqueId}\``, inline: false },
          { name: 'Intentos Restantes', value: `${MAX_USES - userData.uses}/${MAX_USES}` }
        )
        .setImage(newCardBase.image_url);

      return interaction.editReply({ embeds: [embedSuccess] });

    } catch (err) {
      console.error(err);
      return interaction.editReply('❌ Ocurrió un error inesperado en Project Alpha.');
    }
  }
};
