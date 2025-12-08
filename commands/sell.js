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
// Emoji de etiqueta para venta (puedes cambiarlo por tu custom tag emoji si tienes uno)
const tagEmoji = '🏷️'; 

// --- 📊 CONFIGURACIÓN DE ECONOMÍA ---
const PRICE_RANGES = {
  1: { min: 50, max: 200 },
  2: { min: 500, max: 2000 },
  3: { min: 5000, max: 20000 }
};

const TAX_RATE = 0.5; // 50% de multa sobre la diferencia

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

    // Limpieza de códigos (quitar duplicados y espacios vacíos)
    const codesArr = [...new Set(codesInput.split(/[\s,]+/).filter(c => c))];

    if (codesArr.length === 0) {
        return interaction.reply({ content: '❌ Debes escribir al menos un código.', ephemeral: true });
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      // 1. BUSCAR CARTAS EN DB
      // Traemos rarity_level desde base_cards para saber el rango correcto
      const { data: cards, error } = await supabase
        .from('user_cards')
        .select(`
            id, unique_card_id, is_nft,
            base_cards (name, group_name, rarity_level)
        `)
        .in('unique_card_id', codesArr)
        .eq('user_id', userId);

      if (error) {
        console.error('Error DB:', error);
        return interaction.editReply('❌ Error de base de datos al buscar las cartas.');
      }

      if (!cards || cards.length === 0) {
        return interaction.editReply('❌ No encontré ninguna de esas cartas en tu inventario (o no son tuyas).');
      }

      // NO FILTRAMOS NFT: El usuario pidió poder venderlas igual.
      // Solo verificamos que existan.
      const validCards = cards; 

      // 2. CÁLCULO DE IMPUESTOS Y ADVERTENCIAS DE RANGO
      let totalTax = 0;
      let warningLines = new Set(); // Usamos Set para no repetir mensajes iguales

      if (price > 0) {
        validCards.forEach(c => {
            // Obtener rareza (fallback a 1 si no está definida)
            const rarity = c.base_cards.rarity_level || 1;
            const range = PRICE_RANGES[rarity] || PRICE_RANGES[1];
            
            let diff = 0;

            // Verificamos si se sale del rango
            if (price < range.min) diff = range.min - price;
            else if (price > range.max) diff = price - range.max;

            // Si hay diferencia, calculamos impuesto y guardamos el mensaje
            if (diff > 0) {
                totalTax += Math.floor(diff * TAX_RATE);
                warningLines.add(`• Rareza ${rarity}: Rango recomendado **${range.min} - ${range.max}** ${moneyEmoji}`);
            }
        });
      }

      // Chequeo preventivo de saldo si hay impuesto
      if (totalTax > 0) {
        const { data: user } = await supabase.from('users').select('balance').eq('user_id', userId).single();
        const userBalance = user ? user.balance : 0;
        
        if (userBalance < totalTax) {
             const warningText = Array.from(warningLines).join('\n');
             return interaction.editReply(`❌ **No tienes fondos para pagar el impuesto.**\n\n${warningText}\n\nEl precio se aleja demasiado. Necesitas **${totalTax}** ${moneyEmoji} para publicar.`);
        }
      }

      // 3. CONSTRUCCIÓN DEL EMBED DE CONFIRMACIÓN
      let description = `Estás a punto de ${price > 0 ? 'vender' : 'retirar'} **${validCards.length}** cartas.`;
      
      if (price > 0) {
          description += `\n${tagEmoji} **Precio:** ${price} ${moneyEmoji} c/u`;
      }

      // Lista visual de cartas
      const cardList = validCards.slice(0, 10).map(c => {
          const nftIcon = c.is_nft ? '🔒' : ''; // Indicador visual si es NFT
          return `• ${c.base_cards.name} (\`${c.unique_card_id}\`) ${nftIcon}`;
      }).join('\n');
      
      description += `\n\n**Cartas:**\n${cardList}`;
      if (validCards.length > 10) description += `\n...y ${validCards.length - 10} más.`;

      // Agregar sección de advertencia si hay impuesto
      if (totalTax > 0) {
          const warningText = Array.from(warningLines).join('\n');
          description += `\n\n⚠️ **¡Precio fuera de rango!**\n${warningText}\nEl precio ingresado se aleja de lo recomendado.\n**Debes pagar un impuesto de ${totalTax} ${moneyEmoji} para proceder.**`;
      }

      const embed = new EmbedBuilder()
        .setColor(totalTax > 0 ? '#e74c3c' : '#2ecc71') // Rojo alerta o Verde bien
        .setTitle(price > 0 ? '💰 Confirmar Venta' : '🗑️ Confirmar Retiro')
        .setDescription(description)
        .setFooter({ text: '¿Deseas continuar?' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accept').setLabel('Aceptar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ignore').setLabel('Ignorar').setStyle(ButtonStyle.Danger)
      );

      const message = await interaction.editReply({ embeds: [embed], components: [row] });

      // 4. MANEJO DE BOTONES
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000
      });

      collector.on('collect', async i => {
        if (i.customId === 'ignore') {
            collector.stop('cancelled');
            await i.update({ content: '❌ Operación cancelada.', embeds: [], components: [] });
            return;
        }

        if (i.customId === 'accept') {
            collector.stop('confirmed');

            // A. COBRAR IMPUESTO (Transacción segura)
            if (totalTax > 0) {
                const { data: freshUser } = await supabase.from('users').select('balance').eq('user_id', userId).single();
                
                if (!freshUser || freshUser.balance < totalTax) {
                    return i.update({ content: '❌ Error: Tus fondos cambiaron y ya no alcanzan para el impuesto.', embeds: [], components: [] });
                }
                
                const { error: taxError } = await supabase
                    .from('users')
                    .update({ balance: freshUser.balance - totalTax })
                    .eq('user_id', userId);
                
                if (taxError) {
                    return i.update({ content: '❌ Error al cobrar el impuesto.', embeds: [], components: [] });
                }
            }

            // B. ACTUALIZAR BASE DE DATOS (Poner en venta)
            // Si el precio es 0, enviamos NULL a la base de datos para quitar la venta
            const finalPrice = price > 0 ? price : null;
            const idsToUpdate = validCards.map(c => c.id);

            const { error: updateError } = await supabase
                .from('user_cards')
                .update({ market_price: finalPrice })
                .in('id', idsToUpdate);

            if (updateError) {
                console.error('Update Error:', updateError);
                return i.update({ content: '❌ Error al actualizar la base de datos.', embeds: [], components: [] });
            }

            const successMsg = price > 0 
                ? `✅ **¡Listado!** ${validCards.length} cartas están ahora en el Marketplace.` + (totalTax > 0 ? ` (Impuesto pagado: ${totalTax})` : '')
                : `✅ **¡Retirado!** Las cartas ya no están en venta.`;

            await i.update({ content: successMsg, embeds: [], components: [] });
        }
      });

    } catch (err) {
      console.error('Error crítico en sell:', err);
      try { await interaction.editReply('❌ Ocurrió un error inesperado.'); } catch (e) {}
    }
  }
};
