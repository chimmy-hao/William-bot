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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('💰 Compra Packs de la tienda o Cartas del Marketplace')
    // OPCIÓN A: PACKS
    .addStringOption(opt =>
      opt.setName('pack')
        .setDescription('Selecciona un Pack de la tienda')
        .setAutocomplete(true)
        .setRequired(false)
    )
    // OPCIÓN B: CARTAS
    .addStringOption(opt =>
        opt.setName('cards') 
          .setDescription('Códigos del Marketplace separados por espacio (Ej: WMO.1234 CES.5678)')
          .setRequired(false)
      )
    // OPCIÓN C: CANTIDAD (Solo para packs)
    .addIntegerOption(opt => 
        opt.setName('amount')
          .setDescription('Cantidad de Packs a comprar (Máximo 10)')
          .setMinValue(1)
          .setMaxValue(10)
          .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'pack') {
        const { data: packs } = await supabase.from('packs').select('name, code');
        if (!packs) return interaction.respond([]);
        const filtered = packs.filter(p => p.name.toLowerCase().includes(focused.value.toLowerCase()));
        await interaction.respond(
            filtered.slice(0, 25).map(p => ({ name: p.name, value: p.code }))
        );
    }
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    const packCode = interaction.options.getString('pack');
    const cardCodesInput = interaction.options.getString('cards');
    const amount = interaction.options.getInteger('amount') || 1;

    try {
        if (!packCode && !cardCodesInput) {
            return interaction.reply({ content: '❌ Debes elegir qué comprar: un **Pack** o **Cartas** del mercado.', ephemeral: true });
        }

        await interaction.deferReply();

        // 1. Obtener usuario (Balance)
        const { data: user } = await supabase.from('users').select('balance').eq('user_id', userId).single();
        if (!user) return interaction.editReply('❌ No tienes cuenta registrada. Usa /work primero.');

        // ==================================================================
        // 🛍️ CASO A: COMPRAR PACK
        // ==================================================================
        if (packCode) {
            const { data: packConfig } = await supabase.from('packs').select('*').eq('code', packCode).single();
            if (!packConfig) return interaction.editReply('❌ Ese pack no existe.');

            const totalCost = packConfig.price * amount;

            if (user.balance < totalCost) {
                return interaction.editReply(`❌ **Fondos insuficientes.**\nNecesitas: ${totalCost} ${moneyEmoji}\nTienes: ${user.balance} ${moneyEmoji}`);
            }

            // Transacción
            // 1. Descontar dinero
            await supabase.from('users').update({ balance: user.balance - totalCost }).eq('user_id', userId);

            // 2. Dar Pack (Upsert: Sumar a lo que ya tiene)
            const { data: currentPack } = await supabase.from('user_packs').select('quantity').eq('user_id', userId).eq('pack_code', packCode).single();
            const newQuantity = (currentPack?.quantity || 0) + amount;

            await supabase.from('user_packs').upsert({ 
                user_id: userId, 
                pack_code: packCode, 
                quantity: newQuantity 
            }, { onConflict: ['user_id', 'pack_code'] });

            // --- HISTORIAL (Pack Buy) ---
            await supabase.from('history_logs').insert({
                user_id: userId,
                action_type: 'pack_buy',
                amount: -totalCost, // Negativo para indicar gasto
                details: `Compró ${amount}x ${packConfig.name}`
            });
            // ----------------------------

            return interaction.editReply(`✅ **¡Compra exitosa!**\nHas comprado **${amount}x ${packConfig.emoji} ${packConfig.name}** por **${totalCost}** ${moneyEmoji}.`);
        }

        // ==================================================================
        // 🏷️ CASO B: COMPRAR CARTA (Marketplace)
        // ==================================================================
        if (cardCodesInput) {
            // Limpiar códigos
            const codes = [...new Set(cardCodesInput.split(/[\s,]+/).filter(c => c.length > 0))];
            
            // Buscar cartas en venta
            const { data: cardsInMarket } = await supabase
                .from('user_cards')
                .select(`
                    id, unique_card_id, market_price, user_id, 
                    base_cards (name, group_name)
                `)
                .in('unique_card_id', codes)
                .not('market_price', 'is', null); // Solo las que tienen precio

            if (!cardsInMarket || cardsInMarket.length === 0) {
                return interaction.editReply('❌ Ninguna de las cartas indicadas está a la venta.');
            }

            // Validar
            let totalCost = 0;
            const validCards = [];
            const errors = [];

            for (const card of cardsInMarket) {
                if (card.user_id === userId) {
                    errors.push(`- **${card.unique_card_id}**: ¡Es tuya! No puedes comprarte a ti mismo.`);
                    continue;
                }
                validCards.push(card);
                totalCost += card.market_price;
            }

            if (validCards.length === 0) {
                return interaction.editReply(`❌ No se puede procesar la compra:\n${errors.join('\n')}`);
            }

            if (user.balance < totalCost) {
                return interaction.editReply(`❌ **Fondos insuficientes.**\nTotal a pagar: ${totalCost} ${moneyEmoji}\nTienes: ${user.balance} ${moneyEmoji}`);
            }

            // CONFIRMACIÓN
            const embed = new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle('🛒 Confirmar Compra')
                .setDescription(
                    `Estás a punto de comprar **${validCards.length} cartas** por **${totalCost}** ${moneyEmoji}.\n\n` +
                    validCards.map(c => `• **${c.base_cards.name}** (${c.unique_card_id}) - ${c.market_price} ${moneyEmoji}`).join('\n')
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('confirm_buy').setLabel('✅ Confirmar y Pagar').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('cancel_buy').setLabel('❌ Cancelar').setStyle(ButtonStyle.Secondary)
            );

            const msg = await interaction.editReply({ embeds: [embed], components: [row] });

            // Collector
            const filter = i => i.user.id === userId;
            const collector = msg.createMessageComponentCollector({ filter, componentType: ComponentType.Button, time: 60000 });

            collector.on('collect', async i => {
                if (i.customId === 'cancel_buy') {
                    collector.stop();
                    await i.update({ content: '❌ Compra cancelada.', embeds: [], components: [] });
                    return;
                }

                if (i.customId === 'confirm_buy') {
                    // Re-verificar balance por seguridad
                    const { data: checkUser } = await supabase.from('users').select('balance').eq('user_id', userId).single();
                    if (checkUser.balance < totalCost) {
                        return i.update({ content: '❌ Fondos insuficientes al momento de pagar.', embeds: [], components: [] });
                    }

                    // EJECUCIÓN
                    // 1. Cobrar al comprador
                    await supabase.from('users').update({ balance: checkUser.balance - totalCost }).eq('user_id', userId);

                    // 2. Procesar cada carta
                    for (const card of validCards) {
                        // A. Pagar al vendedor
                        const { data: seller } = await supabase.from('users').select('balance').eq('user_id', card.user_id).single();
                        if (seller) {
                            await supabase.from('users').update({ balance: seller.balance + card.market_price }).eq('user_id', card.user_id);
                        }

                        // B. Transferir carta
                        await supabase.from('user_cards').update({
                            user_id: userId,
                            market_price: null // Ya no está en venta
                        }).eq('id', card.id);
                    }

                    // --- HISTORIAL CORREGIDO (Market Buy) ---
                    await supabase.from('history_logs').insert({
                        user_id: userId,
                        action_type: 'market_buy', // 👈 CORREGIDO: market_buy en vez de pack_buy
                        amount: -totalCost,
                        details: `Compró ${validCards.length} cartas en el Marketplace`
                    });
                    // ----------------------------------------

                    collector.stop('success');
                    
                    const successEmbed = new EmbedBuilder()
                        .setColor('#2ecc71')
                        .setTitle('✅ ¡Compra Exitosa!')
                        .setDescription(`Has adquirido tus items por **${totalCost}** ${moneyEmoji}.\nRevisa tu inventario.`)
                        .setTimestamp();

                    await i.update({ embeds: [successEmbed], components: [] });
                }
            });

            collector.on('end', (_, reason) => {
                if (reason === 'time') {
                    interaction.editReply({ content: '⏳ Tiempo agotado.', components: [] }).catch(() => {});
                }
            });
        }

    } catch (err) {
        console.error('Error en buy:', err);
        try { await interaction.editReply({ content: '❌ Error al procesar la compra.', embeds: [], components: [] }); } catch {}
    }
  }
};
