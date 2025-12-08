const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType 
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const moneyEmoji = '<:berrycoin:1411737957081288724>';
const tagEmoji = '🏷️'; 

// --- 📊 CONFIGURACIÓN DE ECONOMÍA ---
const PRICE_RANGES = {
  1: { min: 50, max: 200 },
  2: { min: 500, max: 2000 },
  3: { min: 5000, max: 20000 }
};

const TAX_RATE = 0.5; 

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('💰 Pon cartas a la venta en el Marketplace')
    .addStringOption(opt =>
      opt.setName('codes')
        .setDescription('Códigos de las cartas a vender (separados por espacio)')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('price')
        .setDescription('Precio por cada carta (0 para quitar de venta)')
        .setMinValue(0)
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const codesInput = interaction.options.getString('codes');
    const price = interaction.options.getInteger('price');

    const codesArr = [...new Set(codesInput.split(/[\s,]+/).filter(c => c))];

    if (codesArr.length === 0) {
        return interaction.reply({ content: '❌ Debes escribir al menos un código.', ephemeral: true });
    }

    try {
      // Paso 1: Respuesta Efímera (Solo tú la ves)
      await interaction.deferReply({ ephemeral: true });

      // BUSCAR CARTAS
      const { data: cards, error } = await supabase
        .from('user_cards')
        .select(`
            id, unique_card_id, is_nft, rarity,
            base_cards (name, group_name, rarity_level)
        `)
        .in('unique_card_id', codesArr)
        .eq('user_id', userId);

      if (error) {
        console.error('Error DB:', error);
        return interaction.editReply('❌ Error de base de datos.');
      }

      if (!cards || cards.length === 0) {
        return interaction.editReply('❌ No encontré esas cartas en tu inventario.');
      }

      const validCards = cards; 

      // CÁLCULO DE IMPUESTOS
      let totalTax = 0;
      let warningLines = new Set();

      if (price > 0) {
        validCards.forEach(c => {
            const rarity = c.base_cards.rarity_level || 1;
            const range = PRICE_RANGES[rarity] || PRICE_RANGES[1];
            let diff = 0;

            if (price < range.min) diff = range.min - price;
            else if (price > range.max) diff = price - range.max;

            if (diff > 0) {
                totalTax += Math.floor(diff * TAX_RATE);
                warningLines.add(`• Rareza ${rarity}: Rango recomendado **${range.min} - ${range.max}** ${moneyEmoji}`);
            }
        });
      }

      // Chequeo de saldo para impuesto
      if (totalTax > 0) {
        const { data: user } = await supabase.from('users').select('balance').eq('user_id', userId).single();
        const userBalance = user ? user.balance : 0;
        
        if (userBalance < totalTax) {
             const warningText = Array.from(warningLines).join('\n');
             return interaction.editReply(`❌ **No tienes fondos para el impuesto.**\n\n${warningText}\n\nNecesitas **${totalTax}** ${moneyEmoji}.`);
        }
      }

      // EMBED DE CONFIRMACIÓN (Privado)
      let description = `Estás a punto de ${price > 0 ? 'vender' : 'retirar'} **${validCards.length}** cartas.`;
      
      if (price > 0) description += `\n${tagEmoji} **Precio:** ${price} ${moneyEmoji} c/u`;

      const cardList = validCards.slice(0, 10).map(c => {
          const nftIcon = c.is_nft ? '🔒' : ''; 
          return `• ${c.base_cards.name} (\`${c.unique_card_id}\`) ${nftIcon}`;
      }).join('\n');
      
      description += `\n\n**Cartas:**\n${cardList}`;
      if (validCards.length > 10) description += `\n...y ${validCards.length - 10} más.`;

      if (totalTax > 0) {
          const warningText = Array.from(warningLines).join('\n');
          description += `\n\n⚠️ **¡Precio fuera de rango!**\n${warningText}\n**Impuesto a pagar: ${totalTax} ${moneyEmoji}**`;
      }

      const embed = new EmbedBuilder()
        .setColor(totalTax > 0 ? '#e74c3c' : '#2ecc71')
        .setTitle(price > 0 ? '💰 Confirmar Venta' : '🗑️ Confirmar Retiro')
        .setDescription(description);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accept').setLabel('Aceptar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ignore').setLabel('Cancelar').setStyle(ButtonStyle.Danger)
      );

      const message = await interaction.editReply({ embeds: [embed], components: [row] });

      // COLLECTOR
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000
      });

      collector.on('collect', async i => {
        // --- EVITAR "INTERACTION FAILED" ---
        // Le decimos a Discord "Espera un momento" inmediatamente.
        await i.deferUpdate(); 

        if (i.customId === 'ignore') {
            collector.stop('cancelled');
            await i.editReply({ content: '❌ Operación cancelada.', embeds: [], components: [] });
            return;
        }

        if (i.customId === 'accept') {
            collector.stop('confirmed');

            // 1. COBRAR IMPUESTO
            if (totalTax > 0) {
                const { data: freshUser } = await supabase.from('users').select('balance').eq('user_id', userId).single();
                if (!freshUser || freshUser.balance < totalTax) {
                    return i.editReply({ content: '❌ Error: Fondos insuficientes al momento de procesar.', embeds: [], components: [] });
                }
                
                await supabase.from('users').update({ balance: freshUser.balance - totalTax }).eq('user_id', userId);
            }

            // 2. ACTUALIZAR BASE DE DATOS
            const finalPrice = price > 0 ? price : null;
            const idsToUpdate = validCards.map(c => c.id);

            const { error: updateError } = await supabase
                .from('user_cards')
                .update({ market_price: finalPrice })
                .in('id', idsToUpdate);

            if (updateError) {
                return i.editReply({ content: '❌ Error al actualizar la base de datos.', embeds: [], components: [] });
            }

            // 3. ACTUALIZAR MENSAJE PRIVADO (Feedback rápido)
            await i.editReply({ 
                content: `✅ Operación exitosa. ${price > 0 ? 'Publicando en el canal...' : 'Cartas retiradas.'}`, 
                embeds: [], 
                components: [] 
            });

            // 4. ENVIAR MENSAJE PÚBLICO (Solo si es venta)
            if (price > 0) {
                const publicEmbed = new EmbedBuilder()
                    .setColor('#f1c40f') // Dorado/Amarillo de Mercado
                    .setTitle('📢 ¡Nuevas cartas en el Marketplace!')
                    .setDescription(`**${interaction.user.username}** ha puesto en venta:`)
                    .addFields(
                        { name: 'Precio', value: `${price} ${moneyEmoji}`, inline: true },
                        { name: 'Cantidad', value: `${validCards.length} cartas`, inline: true }
                    )
                    .setFooter({ text: 'Usa /buy card:CÓDIGO para comprar' })
                    .setTimestamp();

                // Mostramos las primeras 5 cartas en el anuncio público para no spamear
                const publicList = validCards.slice(0, 5).map(c => `• **${c.base_cards.name}** (\`${c.unique_card_id}\`)`).join('\n');
                publicEmbed.addFields({ name: 'Items', value: publicList + (validCards.length > 5 ? `\n...y ${validCards.length - 5} más` : '') });

                // Enviamos al canal (visible para todos)
                await interaction.channel.send({ embeds: [publicEmbed] });
            }
        }
      });

    } catch (err) {
      console.error('Error en sell:', err);
      // Try-catch para el reply por si acaso
      try { await interaction.editReply('❌ Error inesperado.'); } catch (e) {}
    }
  }
};
