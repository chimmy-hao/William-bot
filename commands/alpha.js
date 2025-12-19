const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- CONFIGURACIÓN ---
const SUCCESS_RATE = 0.17; // 17% de Probabilidad de éxito (Hardcore)
const MAX_USES = 3;        // 3 intentos diarios
const COOLDOWN_TIME = 24 * 60 * 60 * 1000; // 24 Horas

// Función auxiliar para generar ID único
const generateUniqueCardCode = (baseCode) => {
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${baseCode}.${randomSuffix}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alpha')
    .setDescription('🐺 Project Alpha: Arriesga una carta para evolucionarla (17% Éxito / 83% Pierdes).')
    .addStringOption(option => 
      option.setName('code')
        .setDescription('El código de la carta que quieres enviar a competir')
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const botId = '1411218644163231804'; // ID del Bot
    const codeInput = interaction.options.getString('code').trim();
    const now = Date.now();

    // ---------------------------------------------------------
    // 1. GESTIÓN DE COOLDOWN (BASE DE DATOS)
    // ---------------------------------------------------------
    
    // Obtener estado actual
    let { data: user } = await supabase
        .from('users')
        .select('alpha_uses, alpha_reset_time')
        .eq('user_id', userId)
        .single();
    
    let uses = user?.alpha_uses || 0;
    let expiresAt = user?.alpha_reset_time || 0;

    // Verificar reset de tiempo
    if (now > expiresAt) {
        uses = 0;
        expiresAt = 0; 
    }

    // Verificar si agotó los usos
    if (uses >= MAX_USES) {
        const remaining = expiresAt - now;
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        
        return interaction.reply({ 
          content: `⏳ **Project Alpha cerrado por hoy.**\nHas agotado tus 3 intentos. Vuelve en **${hours}h ${mins}m**.`, 
          ephemeral: true 
        });
    }

    await interaction.deferReply();

    try {
      // ---------------------------------------------------------
      // 2. VALIDAR CARTA
      // ---------------------------------------------------------

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

      if (currentRarity >= 3) {
        return interaction.editReply('👑 ¡Esta carta ya es un verdadero **Alpha** (Rareza 3)! No puede ascender más.');
      }

      // ---------------------------------------------------------
      // 3. SACRIFICIO (Transferir al Bot)
      // ---------------------------------------------------------
      const { error: moveError } = await supabase
        .from('user_cards')
        .update({ user_id: botId }) 
        .eq('id', cardData.id);

      if (moveError) {
        return interaction.editReply('❌ Error al procesar el sacrificio de la carta.');
      }

      // ---------------------------------------------------------
      // 4. RESULTADO DEL JUEGO
      // ---------------------------------------------------------
      const isSuccess = Math.random() < SUCCESS_RATE; 

      // Preparar actualización de usuario
      uses += 1;
      let newExpiresAt = expiresAt;
      
      // Si es el primer uso del ciclo, fijamos el tiempo de expiración
      if (uses === 1 || expiresAt === 0) {
        newExpiresAt = now + COOLDOWN_TIME;
      }

      // OBJETO DE ACTUALIZACIÓN (Común para éxito y fallo)
      let userUpdates = {
          user_id: userId,
          alpha_uses: uses,
          alpha_reset_time: newExpiresAt
      };

      // 🔔 SOLO ACTIVAR AVISO AL GASTAR EL ÚLTIMO INTENTO
      if (uses >= MAX_USES) {
          userUpdates.alpha_notified = false;
      }

      // --- CAMINO A: FRACASO ❌ ---
      if (!isSuccess) {
        // Actualizar Usuario
        await supabase.from('users').upsert(userUpdates, { onConflict: 'user_id' });

        // 📜 Historial (Derrota)
        await supabase.from('history_logs').insert({
            user_id: userId,
            action_type: 'alpha_fail',
            details: `Alpha Fallo: Sacrificó ${cardData.base_cards.name} (${currentRarity}⭐)`
        });

        const embedFail = new EmbedBuilder()
          .setColor('#2b2b2b')
          .setTitle('🐺❌ Eliminado de la Manada')
          .setDescription(
            `La carta **${cardData.base_cards.name}** no superó la prueba.\n` +
            `Ha sido reclamada por William Bot.`
          )
          .addFields({ name: 'Intentos Restantes', value: `${MAX_USES - uses}/${MAX_USES}` })
          .setFooter({ text: 'Better luck next time...' });

        return interaction.editReply({ embeds: [embedFail] });
      }

      // --- CAMINO B: ÉXITO 🐺🌕 ---
      
      const nextRarity = currentRarity + 1;
      
      // Buscar carta upgrade
      const { data: possibleUpgrades } = await supabase
        .from('base_cards')
        .select('*')
        .eq('rarity_level', nextRarity);

      if (!possibleUpgrades || possibleUpgrades.length === 0) {
        return interaction.editReply('⚠️ ¡Has ganado! Pero hubo un error buscando la carta de premio.');
      }

      const newCardBase = possibleUpgrades[Math.floor(Math.random() * possibleUpgrades.length)];
      const newUniqueId = generateUniqueCardCode(newCardBase.card_code);

      // Entregar carta nueva
      await supabase.from('user_cards').insert({
        user_id: userId,
        card_id: newCardBase.id,
        rarity: nextRarity,
        unique_card_id: newUniqueId
      });

      // Actualizar Usuario (Cooldown)
      await supabase.from('users').upsert(userUpdates, { onConflict: 'user_id' });

      // 📜 Historial (Victoria)
      await supabase.from('history_logs').insert({
        user_id: userId,
        action_type: 'alpha_win',
        details: `Alpha Éxito: ${cardData.base_cards.name} -> ${newCardBase.name} (${nextRarity}⭐)`
      });

      const embedSuccess = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🐺🌕 ¡Ascenso Alpha Exitoso!')
        .setDescription(`¡Un aullido de victoria! Tu carta ha evolucionado.`)
        .addFields(
          { name: 'Sacrificio', value: `~~${cardData.base_cards.name}~~ (R${currentRarity})`, inline: true },
          { name: 'Nueva Alpha', value: `**${newCardBase.name}** (R${nextRarity})`, inline: true },
          { name: 'Código', value: `\`${newUniqueId}\``, inline: false },
          { name: 'Intentos Restantes', value: `${MAX_USES - uses}/${MAX_USES}` }
        )
        .setImage(newCardBase.image_url);

      return interaction.editReply({ embeds: [embedSuccess] });

    } catch (err) {
      console.error(err);
      return interaction.editReply('❌ Ocurrió un error inesperado en Project Alpha.');
    }
  }
};
