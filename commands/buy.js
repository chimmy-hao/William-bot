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
    // OPCIÓN B: CARTAS (Múltiples códigos)
    .addStringOption(opt =>
        opt.setName('cards') // Cambiado a plural para que se entienda
          .setDescription('Códigos del Marketplace separados por espacio (Ej: WMO.1234 CES.5678)')
          .setRequired(false)
      )
    // OPCIÓN C: CANTIDAD (Solo para packs)
    .addIntegerOption(opt => 
        opt.setName('amount')
          .setDescription('Cantidad de Packs a comprar (Solo aplica si eliges un Pack)')
          .setMinValue(1)
          .setMaxValue(50)
          .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();

    // Buscamos packs en DB
    const { data: packs } = await supabase
      .from('packs')
      .select('code, name, price')
      .order('price', { ascending: true });

    if (!packs) return interaction.respond([]);

    const filtered = packs.filter(p => p.name.toLowerCase().includes(focusedValue));

    await interaction.respond(
      filtered.slice(0, 25).map(p => ({
        name: `${p.name} (${p.price} 💰)`, 
        value: p.code
      }))
    );
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    
    const packCode = interaction.options.getString('pack');
    const cardsInput = interaction.options.getString('cards');
    const quantity = interaction.options.getInteger('amount') || 1; 

    // Validación inicial
    if (!packCode && !cardsInput) {
        return interaction.reply({ content: '⚠️ Debes elegir un **Pack** o escribir códigos de **Cartas**.', ephemeral: true });
    }
    if (packCode && cardsInput) {
        return interaction.reply({ content: '⚠️ Por favor, compra Packs o Cartas por separado.', ephemeral: true });
    }

    try {
        await interaction.deferReply();

        // --- VARIABLES PARA EL RESUMEN ---
        let totalCost = 0;
        let confirmTitle = '';
        let confirmDescription = '';
        let purchaseType = ''; // 'pack' o 'cards'
        
        // Datos temporales
        let packData = null;
        let cardsToBuy = [];

        // ====================================================
        // 1. PREPARACIÓN: SI ES PACK
        // ====================================================
        if (packCode) {
            const { data: pack } = await supabase.from('packs').select('*').eq('code', packCode).single();
            if (!pack) return interaction.editReply('❌ Ese pack no existe.');

            purchaseType = 'pack';
            packData = pack;
            totalCost = pack.price * quantity;
            
            confirmTitle = `🛒 Confirmar compra de Pack`;
            confirmDescription = `**Item:** ${pack.emoji} ${pack.name}\n**Cantidad:** x${quantity}\n**Total:** ${totalCost} ${moneyEmoji}`;
        }

        // ====================================================
        // 2. PREPARACIÓN: SI SON CARTAS (MARKETPLACE)
        // ====================================================
        if (cardsInput) {
            purchaseType = 'cards';
            // Limpiar códigos
            const codesArr = [...new Set(cardsInput.split(/[\s,]+/).filter(c => c))];

            // Buscar en DB todas las cartas que coincidan con esos códigos
            const { data: foundCards, error } = await supabase
                .from('user_cards')
                .select(`
                    id, user_id, unique_card_id, market_price,
                    base_cards (name, group_name, rarity_level)
                `)
                .in('unique_card_id', codesArr);

            if (error) throw error;

            // Filtrar solo las que se pueden comprar
            // (Tienen precio, no son mías)
            const validCards = foundCards.filter(c => 
                c.market_price !== null && 
                c.user_id !== userId
            );

            if (validCards.length === 0) {
                return interaction.editReply('❌ Ninguna de las cartas ingresadas está disponible para comprar (o son tuyas).');
            }

            cardsToBuy = validCards;
            totalCost = validCards.reduce((sum, c) => sum + c.market_price, 0);

            // Crear lista visual para el embed
            const cardList = validCards.map(c => 
                `• **${c.base_cards.name}** (${c.base_cards.group_name}) - \`${c.unique_card_id}\` - **${c.market_price}** ${moneyEmoji}`
            ).join('\n');

            confirmTitle = `🛒 Confirmar compra de Cartas`;
            confirmDescription = `Has seleccionado **${validCards.length}** carta(s) válida(s).\n\n${cardList}\n\n**Total a Pagar:** ${totalCost} ${moneyEmoji}`;
            
            // Advertencia si algunos códigos no eran válidos
            if (validCards.length < codesArr.length) {
                confirmDescription += `\n⚠️ *(${codesArr.length - validCards.length} códigos fueron ignorados por no estar en venta o ser tuyos).*`;
            }
        }

        // ====================================================
        // 3. VERIFICAR BALANCE DEL COMPRADOR
        // ====================================================
        const { data: buyerData } = await supabase.from('users').select('balance').eq('user_id', userId).single();
        // Si no tiene perfil, lo creamos con 0
        let currentBalance = buyerData ? buyerData.balance : 0;
        if (!buyerData) {
             await supabase.from('users').insert({ user_id: userId, username, balance: 0 });
             currentBalance = 0;
        }

        if (currentBalance < totalCost) {
            return interaction.editReply(`❌ **Fondos Insuficientes.**\nNecesitas: **${totalCost}** ${moneyEmoji}\nTienes: **${currentBalance}** ${moneyEmoji}`);
        }

        // ====================================================
        // 4. MOSTRAR CONFIRMACIÓN
        // ====================================================
        const confirmEmbed = new EmbedBuilder()
            .setColor('#f1c40f') // Amarillo
            .setTitle(confirmTitle)
            .setDescription(confirmDescription)
            .setFooter({ text: 'Tienes 60 segundos para confirmar.' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_buy').setLabel('Comprar').setStyle(ButtonStyle.Success).setEmoji('✅'),
            new ButtonBuilder().setCustomId('cancel_buy').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('✖️')
        );

        const message = await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

        // ====================================================
        // 5. COLLECTOR (Esperar clic)
        // ====================================================
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000,
            filter: i => i.user.id === userId
        });

        collector.on('collect', async i => {
            if (i.customId === 'cancel_buy') {
                collector.stop('cancelled');
                await i.update({ content: '❌ Compra cancelada.', embeds: [], components: [] });
                return;
            }

            if (i.customId === 'confirm_buy') {
                // --- RE-VERIFICACIÓN ATÓMICA ---
                // Volvemos a chequear el saldo por si gastó dinero en otro canal mientras pensaba
                const { data: freshUser } = await supabase.from('users').select('balance').eq('user_id', userId).single();
                if (freshUser.balance < totalCost) {
                    collector.stop('no_funds');
                    return i.update({ content: '❌ Fondos insuficientes al momento de procesar.', embeds: [], components: [] });
                }

                // --- EJECUCIÓN DE LA COMPRA ---
                
                if (purchaseType === 'pack') {
                    // 1. Restar dinero
                    await supabase.from('users').update({ balance: freshUser.balance - totalCost }).eq('user_id', userId);
                    
                    // 2. Dar Packs
                    const { data: userPack } = await supabase.from('user_packs').select('quantity').eq('user_id', userId).eq('pack_code', packData.code).single();
                    const newQty = (userPack?.quantity || 0) + quantity;
                    
                    await supabase.from('user_packs').upsert(
                        { user_id: userId, pack_code: packData.code, quantity: newQty },
                        { onConflict: ['user_id', 'pack_code'] }
                    );
                }

                if (purchaseType === 'cards') {
                    // 1. Restar dinero al comprador
                    await supabase.from('users').update({ balance: freshUser.balance - totalCost }).eq('user_id', userId);

                    // 2. Procesar cada carta (Transferir + Pagar al vendedor)
                    // Lo hacemos en bucle para pagarle a cada dueño original
                    for (const card of cardsToBuy) {
                        // A. Pagar al vendedor
                        const { data: seller } = await supabase.from('users').select('balance').eq('user_id', card.user_id).single();
                        if (seller) {
                            await supabase.from('users').update({ balance: seller.balance + card.market_price }).eq('user_id', card.user_id);
                        }

                        // B. Transferir carta y quitar precio
                        await supabase.from('user_cards').update({
                            user_id: userId,
                            market_price: null // Ya no está en venta
                        }).eq('id', card.id);
                    }
                }

                collector.stop('success');
                
                // MENSAJE FINAL
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

    } catch (err) {
        console.error('Error en buy:', err);
        // Intentar avisar si falla
        try { await interaction.editReply({ content: '❌ Error al procesar la compra.', embeds: [], components: [] }); } catch {}
    }
  }
};
