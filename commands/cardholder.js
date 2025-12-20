const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const SIZES = {
    small:  { w: 543, h: 757,  label: 'Small (543x757)' },
    medium: { w: 642, h: 856,  label: 'Medium (642x856)' },
    big:    { w: 642, h: 1032, label: 'Big (642x1032)' }
};

// ID del Rol de Administrador para borrar
const ADMIN_ROLE_ID = '1412852141197885464';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cardholder')
        .setDescription('🎨 Sistema de marcos decorativos (Cardholders)')
        // --- CREATE (Emoji Requerido) ---
        .addSubcommand(subcommand =>
            subcommand.setName('create').setDescription('Sube tu propio cardholder a la tienda.')
                .addStringOption(o => o.setName('code').setDescription('ID único (Máx 5 letras)').setMaxLength(5).setRequired(true))
                .addStringOption(o => o.setName('name').setDescription('Nombre del marco').setRequired(true))
                .addStringOption(o => o.setName('size').setDescription('Tamaño').setRequired(true).addChoices({ name: 'Small', value: 'small' }, { name: 'Medium', value: 'medium' }, { name: 'Big', value: 'big' }))
                .addIntegerOption(o => o.setName('price').setDescription('Precio (100-500)').setMinValue(100).setMaxValue(500).setRequired(true))
                .addAttachmentOption(o => o.setName('image').setDescription('PNG Transparente').setRequired(true))
                .addStringOption(o => o.setName('emoji').setDescription('Emoji identificador').setRequired(true))) 
        // --- FIX (Editar propio) ---
        .addSubcommand(subcommand =>
            subcommand.setName('fix').setDescription('🔧 Edita uno de tus cardholders.')
                .addStringOption(o => o.setName('code').setDescription('Elige el holder a editar (Autocompletado)').setRequired(true).setAutocomplete(true))
                .addStringOption(o => o.setName('new_name').setDescription('(Opcional) Nuevo nombre'))
                .addIntegerOption(o => o.setName('new_price').setDescription('(Opcional) Nuevo precio (100-500)').setMinValue(100).setMaxValue(500))
                .addStringOption(o => o.setName('new_emoji').setDescription('(Opcional) Nuevo emoji'))
                .addAttachmentOption(o => o.setName('new_image').setDescription('(Opcional) Nueva imagen PNG (Debe mantener tamaño original)')))
        // --- DELETE (Admin Only) ---
        .addSubcommand(subcommand =>
            subcommand.setName('delete').setDescription('⛔ [ADMIN] Eliminar un cardholder de la base de datos.')
                .addStringOption(o => o.setName('code').setDescription('Código del holder a eliminar').setRequired(true)))
        // --- SHOP ---
        .addSubcommand(subcommand =>
            subcommand.setName('shop').setDescription('Ver la tienda de marcos.'))
        // --- BUY ---
        .addSubcommand(subcommand =>
            subcommand.setName('buy').setDescription('Comprar un marco de la tienda.')
                .addStringOption(o => o.setName('holder_code').setDescription('El código del marco a comprar').setRequired(true)))
        // --- USE ---
        .addSubcommand(subcommand =>
            subcommand.setName('use').setDescription('Ponerle un marco a una carta.')
                .addStringOption(o => o.setName('card_id').setDescription('ID de tu carta (ej. NJ.1234)').setRequired(true))
                .addStringOption(o => o.setName('holder_code').setDescription('ID del marco').setRequired(true)))
        // --- REMOVE ---
        .addSubcommand(subcommand =>
            subcommand.setName('remove').setDescription('Quitarle el marco a una carta.')
                .addStringOption(o => o.setName('card_id').setDescription('ID de tu carta').setRequired(true))),

    // --- AUTOCOMPLETADO (Solo para FIX) ---
    async autocomplete(interaction, supabase) {
        const focusedOption = interaction.options.getFocused(true);
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (subcommand === 'fix' && focusedOption.name === 'code') {
            const userValue = focusedOption.value.toLowerCase();
            
            // Buscar solo los holders creados por ESTE usuario
            const { data: myHolders } = await supabase
                .from('holders')
                .select('code, name, emoji')
                .eq('creator_id', userId)
                .ilike('code', `%${userValue}%`) 
                .limit(25);

            if (!myHolders) return interaction.respond([]);
            
            return interaction.respond(
                myHolders.map(h => ({ name: `${h.emoji} ${h.code} — ${h.name}`, value: h.code }))
            );
        }
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        try {
            // ======================================================
            // ⛔ DELETE (ADMIN ONLY)
            // ======================================================
            if (subcommand === 'delete') {
                // 1. Verificación de Rol
                if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
                    return interaction.reply({ content: '⛔ **Acceso Denegado:** Solo los administradores pueden usar este comando.', ephemeral: true });
                }

                await interaction.deferReply({ ephemeral: true }); // Respuesta privada por seguridad
                const codeToDelete = interaction.options.getString('code').toUpperCase();

                // 2. Verificar existencia
                const { data: holder } = await supabase.from('holders').select('id, name').eq('code', codeToDelete).single();

                if (!holder) {
                    return interaction.editReply(`❌ No se encontró ningún holder con el código **${codeToDelete}**.`);
                }

                // 3. Eliminar de la DB
                const { error } = await supabase.from('holders').delete().eq('id', holder.id);

                if (error) throw error;

                return interaction.editReply(`✅ **Eliminado:** El cardholder **${holder.name}** (\`${codeToDelete}\`) ha sido borrado de la base de datos permanentemente.`);
            }

            // ======================================================
            // 🎨 CREATE
            // ======================================================
            if (subcommand === 'create') {
                await interaction.deferReply();
                const code = interaction.options.getString('code').toUpperCase().trim();
                const name = interaction.options.getString('name');
                const sizeKey = interaction.options.getString('size');
                const price = interaction.options.getInteger('price');
                const attachment = interaction.options.getAttachment('image');
                const emoji = interaction.options.getString('emoji'); // Requerido

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
                await supabase.from('user_holders').insert({ user_id: userId, holder_id: inserted.id });

                const embed = new EmbedBuilder().setColor('#9b59b6').setTitle(`${emoji} Cardholder Creado`).setDescription(`ID: \`${code}\`\nPrecio: ${price}`).setImage(attachment.url);
                return interaction.editReply({ embeds: [embed] });
            }

            // ======================================================
            // 🔧 FIX (EDITAR)
            // ======================================================
            else if (subcommand === 'fix') {
                await interaction.deferReply();
                const codeInput = interaction.options.getString('code');
                const newName = interaction.options.getString('new_name');
                const newPrice = interaction.options.getInteger('new_price');
                const newEmoji = interaction.options.getString('new_emoji');
                const newImage = interaction.options.getAttachment('new_image');

                const { data: holder } = await supabase.from('holders').select('*').eq('code', codeInput).eq('creator_id', userId).single();

                if (!holder) return interaction.editReply('❌ No encontré ese cardholder o no es tuyo.');

                const updates = {};
                let changeLog = '';

                if (newName) { updates.name = newName; changeLog += `• Nombre: **${newName}**\n`; }
                if (newPrice) { updates.price = newPrice; changeLog += `• Precio: **${newPrice}**\n`; }
                if (newEmoji) { updates.emoji = newEmoji; changeLog += `• Emoji: ${newEmoji}\n`; }
                if (newImage) {
                    if (newImage.contentType !== 'image/png') return interaction.editReply('❌ La imagen debe ser PNG.');
                    const targetSize = SIZES[holder.size];
                    if (!newImage.width || newImage.width !== targetSize.w || newImage.height !== targetSize.h) {
                        return interaction.editReply(`❌ Medidas incorrectas. Deben ser **${targetSize.w}x${targetSize.h}** px.`);
                    }
                    updates.image_url = newImage.url;
                    changeLog += `• Nueva imagen actualizada.\n`;
                }

                if (Object.keys(updates).length === 0) return interaction.editReply('⚠️ No hiciste ningún cambio.');

                const { error } = await supabase.from('holders').update(updates).eq('id', holder.id);
                if (error) throw error;

                const embed = new EmbedBuilder().setColor('#f1c40f').setTitle(`🔧 Holder Editado: ${holder.code}`).setDescription(changeLog);
                if (newImage || holder.image_url) embed.setThumbnail(newImage ? newImage.url : holder.image_url);
                
                return interaction.editReply({ embeds: [embed] });
            }

            // ======================================================
            // 🛍️ SHOP
            // ======================================================
            else if (subcommand === 'shop') {
                await interaction.deferReply();
                const { data: holders } = await supabase.from('holders').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(10);
                if (!holders?.length) return interaction.editReply('📭 Tienda vacía.');

                const embed = new EmbedBuilder().setColor('#e67e22').setTitle('🎨 Tienda de Cardholders');
                let desc = '';
                holders.forEach(h => desc += `**${h.emoji} ${h.name}** (\`${h.code}\`)\n💰 **${h.price}** • 📏 ${h.size.toUpperCase()}\nCreator: <@${h.creator_id}>\n\n`);
                embed.setDescription(desc + 'Usa `/cardholder buy [code]` para comprar.');
                if (holders[0].image_url) embed.setThumbnail(holders[0].image_url);
                return interaction.editReply({ embeds: [embed] });
            }

            // ======================================================
            // 💰 BUY
            // ======================================================
            else if (subcommand === 'buy') {
                await interaction.deferReply();
                const holderCode = interaction.options.getString('holder_code').toUpperCase();
                const { data: holder } = await supabase.from('holders').select('*').eq('code', holderCode).eq('is_active', true).single();
                if (!holder) return interaction.editReply('❌ No existe o no está disponible.');

                const { data: buyer } = await supabase.from('users').select('balance').eq('user_id', userId).single();
                if ((buyer?.balance || 0) < holder.price) return interaction.editReply(`❌ Te faltan monedas. Cuesta **${holder.price}**.`);

                await supabase.from('users').update({ balance: buyer.balance - holder.price }).eq('user_id', userId);
                if (holder.creator_id !== userId) {
                     const { data: creator } = await supabase.from('users').select('balance').eq('user_id', holder.creator_id).single();
                     if (creator) await supabase.from('users').update({ balance: creator.balance + holder.price }).eq('user_id', holder.creator_id);
                }
                
                await supabase.from('user_holders').insert({ user_id: userId, holder_id: holder.id });
                await supabase.from('holders').update({ sales_count: (holder.sales_count || 0) + 1 }).eq('id', holder.id);

                return interaction.editReply(`✅ Comprado: **${holder.name}**.`);
            }

            // ======================================================
            // 🖼️ USE
            // ======================================================
            else if (subcommand === 'use') {
                await interaction.deferReply();
                const cardId = interaction.options.getString('card_id');
                const holderCode = interaction.options.getString('holder_code').toUpperCase();

                const { data: card } = await supabase.from('user_cards').select('id, unique_card_id, base_cards(rarity)').eq('unique_card_id', cardId).eq('user_id', userId).single();
                if (!card) return interaction.editReply('❌ No tienes esa carta.');

                const { data: holderInfo } = await supabase.from('holders').select('id, name, size').eq('code', holderCode).single();
                if (!holderInfo) return interaction.editReply('❌ No existe ese holder.');

                // Validar Tamaño
                let cardSize = 'small';
                if (card.base_cards.rarity === 2) cardSize = 'medium';
                if (card.base_cards.rarity === 3) cardSize = 'big';

                if (cardSize !== holderInfo.size) return interaction.editReply(`❌ Tamaños incompatibles: Carta **${cardSize}** vs Holder **${holderInfo.size}**.`);

                const { count: ownedCount } = await supabase.from('user_holders').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('holder_id', holderInfo.id);
                const { count: usedCount } = await supabase.from('user_cards').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('equipped_holder_id', holderInfo.id);

                if (!ownedCount || ownedCount <= usedCount) return interaction.editReply(`❌ No tienes suficientes copias libres de **${holderInfo.name}**.`);

                await supabase.from('user_cards').update({ equipped_holder_id: holderInfo.id }).eq('id', card.id);
                return interaction.editReply(`✅ Marco **${holderInfo.name}** equipado en \`${cardId}\`.`);
            }

            // ======================================================
            // 🔧 REMOVE
            // ======================================================
            else if (subcommand === 'remove') {
                await interaction.deferReply();
                const cardId = interaction.options.getString('card_id');
                const { data: card } = await supabase.from('user_cards').select('id').eq('unique_card_id', cardId).eq('user_id', userId).single();
                if (!card) return interaction.editReply('❌ No encontré esa carta.');
                await supabase.from('user_cards').update({ equipped_holder_id: null }).eq('id', card.id);
                return interaction.editReply(`✅ Marco removido de \`${cardId}\`.`);
            }

        } catch (error) {
            console.error('Error cardholder:', error);
            interaction.editReply('❌ Error interno.').catch(() => {});
        }
    }
};
