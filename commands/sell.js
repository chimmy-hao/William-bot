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

// --- CONFIGURACIÓN DE ECONOMÍA ---
const PRICE_RANGES = {
  1: { min: 50, max: 200 },
  2: { min: 500, max: 2000 },
  3: { min: 5000, max: 20000 }
};

// Porcentaje de multa sobre la diferencia (0.5 = 50%)
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
      await interaction.deferReply({ ephemeral: true });

      // 1. BUSCAR CARTAS
      const { data: cards, error } = await supabase
        .from('user_cards')
        .select(`
            id, unique_card_id, rarity, is_nft,
            base_cards (name, group_name)
        `)
        .in('unique_card_id', codesArr)
        .eq('user_id', userId);

      if (error || !cards || cards.length === 0) {
        return interaction.editReply('❌ No encontré ninguna de esas cartas en tu inventario.');
      }

      const validCards = cards.filter(c => !c.is_nft);
      const nftCount = cards.length - validCards.length;

      if (validCards.length === 0) {
        return interaction.editReply('❌ Todas las cartas seleccionadas son NFT o no válidas.');
      }

      // 2. CÁLCULO DE IMPUESTOS PROPORCIONALES
      let totalTax = 0;
      let warningMessage = '';

      if (price > 0) {
        validCards.forEach(c => {
            const range = PRICE_RANGES[c.rarity] || PRICE_RANGES[1];
            let diff = 0;

            if (price < range.min) {
                // Penalización por vender muy barato
                diff = range.min - price;
            } else if (price > range.max) {
                // Penalización por vender muy caro
                diff = price - range.max;
            }

            if (diff > 0) {
                totalTax += Math.floor(diff * TAX_RATE);
            }
        });
      }

      if (totalTax > 0) {
        // Chequeo preventivo de saldo
        const { data: user } = await supabase.from('users').select('balance').eq('user_id', userId).single();
        const balance = user ? user.balance : 0;
        
        if (balance < totalTax) {
             return interaction.editReply(`❌ **No puedes costear el impuesto.**\nEstás poniendo precios fuera de rango.\nImpuesto necesario: **${totalTax}** ${moneyEmoji}\nTu saldo: **${balance}** ${moneyEmoji}`);
        }

        warningMessage = `\n⚠️ **Impuesto por precio fuera de rango:**\nEl precio **${price}** ${moneyEmoji} se aleja de lo recomendado.\nPara publicar, deberás pagar un impuesto de **${totalTax}** ${moneyEmoji} ahora.`;
      }

      // 3. CONFIRMACIÓN
      const embed = new EmbedBuilder()
        .setColor(totalTax > 0 ? '#e74c3c' : '#2ecc71')
        .setTitle(price > 0 ? '💰 Confirmar Venta' : '🗑️ Confirmar Retiro')
        .setDescription(
            `Vas a ${price > 0 ? 'vender' : 'retirar'} **${validCards.length}** cartas.` +
            (price > 0 ? `\n🏷️ **Precio:** ${price} ${moneyEmoji} c/u` : '') +
            (nftCount > 0 ? `\n*(Se omitieron ${nftCount} cartas NFT)*` : '') +
            `\n\n**Cartas:**\n${validCards.slice(0, 10).map(c => `• ${c.base_cards.name} (\`${c.unique_card_id}\`)`).join('\n')}` +
            (validCards.length > 10 ? `\n...y ${validCards.length - 10} más.` : '') +
            warningMessage
        )
        .setFooter({ text: 'Confirma para proceder.' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_sell').setLabel('Aceptar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_sell').setLabel('Ignorar').setStyle(ButtonStyle.Danger)
      );

      const message = await interaction.editReply({ embeds: [embed], components: [row] });

      // 4. COLLECTOR
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000
      });

      collector.on('collect', async i => {
        if (i.customId === 'cancel_sell') {
            collector.stop('cancelled');
            await i.update({ content: '❌ Operación cancelada.', embeds: [], components: [] });
            return;
        }

        if (i.customId === 'confirm_sell') {
            collector.stop('confirmed');

            // A. COBRAR IMPUESTO (Si aplica)
            if (totalTax > 0) {
                const { data: freshUser } = await supabase.from('users').select('balance').eq('user_id', userId).single();
                if (freshUser.balance < totalTax) {
                    return i.update({ content: '❌ Error: Fondos insuficientes para el impuesto.', embeds: [], components: [] });
                }
                await supabase.from('users').update({ balance: freshUser.balance - totalTax }).eq('user_id', userId);
            }

            // B. ACTUALIZAR CARTAS
            const finalPrice = price > 0 ? price : null;
            const idsToUpdate = validCards.map(c => c.id);

            const { error: updateError } = await supabase
                .from('user_cards')
                .update({ market_price: finalPrice })
                .in('id', idsToUpdate);

            if (updateError) {
                return i.update({ content: '❌ Error al actualizar la base de datos.', embeds: [], components: [] });
            }

            const successText = price > 0 
                ? `✅ **¡Publicado!** ${validCards.length} cartas están en el Marketplace por **${price}** ${moneyEmoji}.\n${totalTax > 0 ? `*(Pagaste ${totalTax} de impuesto)*` : ''}` 
                : `✅ **¡Retirado!** ${validCards.length} cartas han sido quitadas de la venta.`;

            await i.update({ content: successText, embeds: [], components: [] });
        }
      });

    } catch (err) {
      console.error('Error en sell:', err);
      await interaction.editReply('❌ Ocurrió un error inesperado.');
    }
  }
};
