const { SlashCommandBuilder } = require('discord.js'); 
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const moneyEmoji = '<:berrycoin:1411737957081288724>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('💰 Compra Packs de la tienda o Cartas del Marketplace')
    // OPCIÓN A: PACKS (Autocompletado)
    .addStringOption(opt =>
      opt.setName('pack')
        .setDescription('Selecciona un Pack de la tienda')
        .setAutocomplete(true)
        .setRequired(false)
    )
    // OPCIÓN B: CARTAS (Código manual)
    .addStringOption(opt =>
        opt.setName('card')
          .setDescription('Pega el código de la carta del Marketplace (Ej: WMO.1234)')
          .setRequired(false)
      )
    // OPCIÓN C: CANTIDAD (Solo para packs)
    .addIntegerOption(opt => 
        opt.setName('amount')
          .setDescription('Cantidad de Packs a comprar (No aplica para cartas)')
          .setMinValue(1)
          .setMaxValue(50) // Límite razonable
          .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();

    // Buscamos los packs en DB (Dinámico: si agregas uno en Supabase, sale acá)
    const { data: packs } = await supabase
      .from('packs')
      .select('code, name, price')
      .order('price', { ascending: true });

    if (!packs) return interaction.respond([]);

    // Filtramos y mostramos Nombre + Precio
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
    const packCode = interaction.options.getString('pack');
    const cardCode = interaction.options.getString('card');
    // Si no pone cantidad, asumimos 1
    const quantity = interaction.options.getInteger('amount') || 1; 

    // Validación: Debe elegir UNO de los dos
    if (!packCode && !cardCode) {
        return interaction.reply({ content: '⚠️ Debes elegir un **Pack** o escribir el código de una **Carta**.', ephemeral: true });
    }
    if (packCode && cardCode) {
        return interaction.reply({ content: '⚠️ Por favor, compra Packs o Cartas por separado, no al mismo tiempo.', ephemeral: true });
    }

    try {
        // --- FLUJO 1: COMPRAR PACK ---
        if (packCode) {
            // 1. Buscar Pack
            const { data: pack } = await supabase.from('packs').select('*').eq('code', packCode).single();
            
            if (!pack) return interaction.reply({ content: '❌ Ese pack no existe.', ephemeral: true });

            const totalCost = pack.price * quantity;

            // 2. Verificar Dinero Comprador
            const { data: buyer } = await supabase.from('users').select('balance').eq('user_id', userId).single();
            // Si no tiene perfil, saldo es 0
            const currentBalance = buyer ? buyer.balance : 0;

            if (currentBalance < totalCost) {
                return interaction.reply({ content: `❌ No tienes suficientes fondos. Costo: **${totalCost}** ${moneyEmoji} (Tienes: ${currentBalance})`, ephemeral: true });
            }

            // 3. Transacción
            // A. Restar dinero
            await supabase.from('users').upsert({ user_id: userId, balance: currentBalance - totalCost });

            // B. Dar Packs (Sumar al inventario)
            const { data: userPack } = await supabase
                .from('user_packs')
                .select('quantity')
                .eq('user_id', userId)
                .eq('pack_code', packCode)
                .single();
            
            const newQty = (userPack?.quantity || 0) + quantity;

            await supabase.from('user_packs').upsert(
                { user_id: userId, pack_code: packCode, quantity: newQty }, 
                { onConflict: ['user_id', 'pack_code'] }
            );

            return interaction.reply(`✅ ¡Compra exitosa! Has adquirido **${quantity}x ${pack.name}** ${pack.emoji} por **${totalCost}** ${moneyEmoji}.`);
        }

        // --- FLUJO 2: COMPRAR CARTA (MARKETPLACE) ---
        if (cardCode) {
            await interaction.deferReply(); // Consultas complejas, diferimos respuesta

            // 1. Buscar la carta y ver si tiene precio (está en venta)
            const { data: cardData, error } = await supabase
                .from('user_cards')
                .select(`
                    id, user_id, market_price, 
                    base_cards (name, group_name, rarity_level)
                `)
                .eq('unique_card_id', cardCode)
                .single();

            if (error || !cardData) {
                return interaction.editReply('❌ No encontré ninguna carta con ese código.');
            }

            // 2. Validaciones de Mercado
            if (cardData.market_price === null) {
                return interaction.editReply('🔒 Esta carta existe, pero su dueño **no la ha puesto en venta**.');
            }
            if (cardData.user_id === userId) {
                return interaction.editReply('❌ No puedes comprar tu propia carta (¡Quítala de la venta si la quieres recuperar!).');
            }

            const price = cardData.market_price;

            // 3. Verificar Dinero Comprador
            const { data: buyer } = await supabase.from('users').select('balance').eq('user_id', userId).single();
            const buyerBal = buyer ? buyer.balance : 0;

            if (buyerBal < price) {
                return interaction.editReply(`❌ No tienes suficientes fondos. La carta cuesta **${price}** ${moneyEmoji}.`);
            }

            // 4. TRANSACCIÓN SEGURA
            // A. Restar al comprador
            await supabase.from('users').update({ balance: buyerBal - price }).eq('user_id', userId);

            // B. Sumar al vendedor
            const { data: seller } = await supabase.from('users').select('balance').eq('user_id', cardData.user_id).single();
            // Si el vendedor no tiene perfil (raro), asumimos 0
            const sellerBal = seller ? seller.balance : 0;
            await supabase.from('users').update({ balance: sellerBal + price }).eq('user_id', cardData.user_id);

            // C. Transferir carta y quitar precio (deslistar)
            const { error: transferError } = await supabase
                .from('user_cards')
                .update({ 
                    user_id: userId,      // Nuevo dueño: Comprador
                    market_price: null    // Ya no está en venta
                })
                .eq('id', cardData.id);

            if (transferError) {
                console.error(transferError);
                return interaction.editReply('❌ Error crítico al transferir la carta. Contacta a soporte.');
            }

            // D. Notificar
            const cardName = cardData.base_cards.name;
            return interaction.editReply(`🤝 **¡Trato cerrado!** Compraste **${cardName}** (\`${cardCode}\`) por **${price}** ${moneyEmoji}. El dueño anterior recibió el dinero.`);
        }

    } catch (err) {
        console.error('Error en buy:', err);
        // Intentamos responder si no se ha respondido aún
        try { await interaction.reply({ content: '❌ Error al procesar la compra.', ephemeral: true }); } catch {}
    }
  }
};



