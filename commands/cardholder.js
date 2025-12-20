const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const SIZES = {
    small:  { w: 543, h: 757,  label: 'Small (543x757)' },
    medium: { w: 642, h: 856,  label: 'Medium (642x856)' },
    big:    { w: 642, h: 1032, label: 'Big (642x1032)' }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cardholder')
        .setDescription('🎨 Sistema de marcos decorativos (Cardholders)')
        // --- CREATE ---
        .addSubcommand(subcommand =>
            subcommand.setName('create').setDescription('Sube tu propio cardholder a la tienda.')
                .addStringOption(o => o.setName('code').setDescription('ID único (Máx 5 letras)').setMaxLength(5).setRequired(true))
                .addStringOption(o => o.setName('name').setDescription('Nombre del marco').setRequired(true))
                .addStringOption(o => o.setName('size').setDescription('Tamaño').setRequired(true).addChoices({ name: 'Small', value: 'small' }, { name: 'Medium', value: 'medium' }, { name: 'Big', value: 'big' }))
                .addIntegerOption(o => o.setName('price').setDescription('Precio (100-500)').setMinValue(100).setMaxValue(500).setRequired(true))
                .addAttachmentOption(o => o.setName('image').setDescription('PNG Transparente').setRequired(true))
                .addStringOption(o => o.setName('emoji').setDescription('Emoji identificador')))
        // --- SHOP ---
        .addSubcommand(subcommand =>
            subcommand.setName('shop').setDescription('Ver la tienda de marcos.'))
        // --- BUY ---
        .addSubcommand(subcommand =>
            subcommand.setName('buy').setDescription('Comprar un marco de la tienda.')
                .addStringOption(o => o.setName('holder_code').setDescription('El código del marco a comprar').setRequired(true)))
        // --- USE (EQUIPAR) ---
        .addSubcommand(subcommand =>
            subcommand.setName('use').setDescription('Ponerle un marco a una carta.')
                .addStringOption(o => o.setName('card_id').setDescription('ID de tu carta (ej. NJ.1234)').setRequired(true))
                .addStringOption(o => o.setName('holder_code').setDescription('ID del marco (ej. HEART)').setRequired(true)))
        // --- REMOVE (DESEQUIPAR) ---
        .addSubcommand(subcommand =>
            subcommand.setName('remove').setDescription('Quitarle el marco a una carta.')
                .addStringOption(o => o.setName('card_id').setDescription('ID de tu carta').setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        try {
            // ======================================================
            // 🎨 CREATE (CREAR MARCO)
            // ======================================================
            if (subcommand === 'create') {
                await interaction.deferReply();
                const code = interaction.options.getString('code').toUpperCase().trim();
                const name = interaction.options.getString('name');
                const sizeKey = interaction.options.getString('size');
                const price = interaction.options.getInteger('price');
                const attachment = interaction.options.getAttachment('image');
                const emoji = interaction.options.getString('emoji') || '🎨';

                if (!/^[A-Z0-9]+$/.test(code)) return interaction.editReply('❌ El Code solo letras y números.');
                if (attachment.contentType !== 'image/png') return interaction.editReply('❌ Debe ser PNG.');

                const targetSize = SIZES[sizeKey];
                if (!attachment.width || attachment.width !== targetSize.w || attachment.height !== targetSize.h) {
                    return interaction.editReply(`❌ Medidas incorrectas. Para **${sizeKey}** deben ser **${targetSize.w}x${targetSize.h}** px.`);
                }

                const { data: existing } = await supabase.from('holders').select('code').eq('code', code).single();
                if (existing) return interaction.editReply(`❌ El código **${code}** ya existe.`);

                const { data: inserted, error } = await supabase.from('holders').insert({
                    code, name, creator_id: userId, image_url: attachment.url, price, size: sizeKey, emoji
                }).select().single();

                if (error) throw error;

                // El creador recibe uno gratis
                await supabase.from('user_holders').insert({ user_id: userId, holder_id: inserted.id });

                const embed = new EmbedBuilder().setColor('#9b59b6').setTitle(`${emoji} Cardholder Creado`).setDescription(`ID: \`${code}\`\nPrecio: ${price}`).setImage(attachment.url);
                return interaction.editReply({ embeds: [embed] });
            }

            // ======================================================
            // 🛍️ SHOP (TIENDA)
            // ======================================================
            else if (subcommand === 'shop') {
                await interaction.deferReply();
                const { data: holders } = await supabase.from('holders').select('*').eq('is_active', true).limit(10);
                
                if (!holders?.length) return interaction.editReply('📭 Tienda vacía.');

                const embed = new EmbedBuilder().setColor('#e67e22').setTitle('🎨 Tienda de Cardholders');
                let desc = '';
                holders.forEach(h => desc += `**${h.emoji} ${h.name}** (\`${h.code}\`)\n💰 **${h.price}** • 📏 ${h.size}\nCreator: <@${h.creator_id}>\n\n`);
                embed.setDescription(desc + 'Usa `/cardholder buy [code]` para comprar.');
                if (holders[0].image_url) embed.setThumbnail(holders[0].image_url);

                return interaction.editReply({ embeds: [embed] });
            }

            // ======================================================
            // 💰 BUY (COMPRAR)
            // ======================================================
            else if (subcommand === 'buy') {
                await interaction.deferReply();
                const holderCode = interaction.options.getString('holder_code').toUpperCase();

                // 1. Buscar Holder
                const { data: holder } = await supabase.from('holders').select('*').eq('code', holderCode).single();
                if (!holder) return interaction.editReply('❌ Ese marco no existe.');

                // 2. Verificar Dinero del Comprador
                const { data: buyer } = await supabase.from('users').select('balance').eq('user_id', userId).single();
                if ((buyer?.balance || 0) < holder.price) return interaction.editReply(`❌ No tienes suficientes monedas. Cuesta **${holder.price}**.`);

                // 3. TRANSACCIÓN ECONÓMICA
                // Restar al comprador
                await supabase.from('users').update({ balance: buyer.balance - holder.price }).eq('user_id', userId);

                // Sumar al creador (Royalty)
                // Obtenemos balance del creador
                const { data: creator } = await supabase.from('users').select('balance').eq('user_id', holder.creator_id).single();
                // Si el creador existe (y no es el mismo comprador, aunque permitimos autocompra), le pagamos
                if (creator) {
                    await supabase.from('users').update({ balance: creator.balance + holder.price }).eq('user_id', holder.creator_id);
                }

                // 4. Entregar Item + Update Stats
                await supabase.from('user_holders').insert({ user_id: userId, holder_id: holder.id });
                await supabase.from('holders').update({ sales_count: (holder.sales_count || 0) + 1 }).eq('id', holder.id);

                return interaction.editReply(`✅ ¡Compraste el marco **${holder.name}** por ${holder.price} monedas!`);
            }

            // ======================================================
            // 🖼️ USE (EQUIPAR)
            // ======================================================
            else if (subcommand === 'use') {
                await interaction.deferReply();
                const cardId = interaction.options.getString('card_id');
                const holderCode = interaction.options.getString('holder_code').toUpperCase();

                // 1. Buscar Carta (debe ser tuya)
                const { data: card } = await supabase.from('user_cards').select('id, unique_card_id').eq('unique_card_id', cardId).eq('user_id', userId).single();
                if (!card) return interaction.editReply('❌ No encontré esa carta en tu inventario.');

                // 2. Buscar Holder (Info General)
                const { data: holderInfo } = await supabase.from('holders').select('id, name').eq('code', holderCode).single();
                if (!holderInfo) return interaction.editReply('❌ Ese código de marco no existe.');

                // 3. CONTAR INVENTARIO (Lógica inteligente)
                // ¿Cuántos tengo comprados?
                const { count: ownedCount } = await supabase.from('user_holders').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('holder_id', holderInfo.id);
                
                // ¿Cuántos estoy usando ya?
                const { count: usedCount } = await supabase.from('user_cards').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('equipped_holder_id', holderInfo.id);

                if (!ownedCount || ownedCount <= usedCount) {
                    return interaction.editReply(`❌ No tienes copias disponibles de **${holderInfo.name}**.\nTienes **${ownedCount || 0}** y estás usando **${usedCount || 0}**.\n🛒 Compra más en la tienda.`);
                }

                // 4. Equipar
                await supabase.from('user_cards').update({ equipped_holder_id: holderInfo.id }).eq('id', card.id);

                return interaction.editReply(`✅ Marco **${holderInfo.name}** equipado en la carta \`${cardId}\`.`);
            }

            // ======================================================
            // 🔧 REMOVE (QUITAR)
            // ======================================================
            else if (subcommand === 'remove') {
                await interaction.deferReply();
                const cardId = interaction.options.getString('card_id');

                const { data: card } = await supabase.from('user_cards').select('id').eq('unique_card_id', cardId).eq('user_id', userId).single();
                if (!card) return interaction.editReply('❌ No encontré esa carta.');

                await supabase.from('user_cards').update({ equipped_holder_id: null }).eq('id', card.id);

                return interaction.editReply(`✅ Se ha quitado el marco de la carta \`${cardId}\`.`);
            }

        } catch (error) {
            console.error('Error cardholder:', error);
            interaction.editReply('❌ Error interno. Revisa la consola o intenta de nuevo.').catch(() => {});
        }
    }
};
