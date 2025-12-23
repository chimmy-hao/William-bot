// AGREGAMOS LOS IMPORTS NECESARIOS PARA IMÁGENES
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
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
        // --- CREATE ---
        .addSubcommand(subcommand =>
            subcommand.setName('create').setDescription('Sube tu propio cardholder a la tienda.')
                .addStringOption(o => o.setName('code').setDescription('ID único (Máx 5 letras)').setMaxLength(5).setRequired(true))
                .addStringOption(o => o.setName('name').setDescription('Nombre del marco').setRequired(true))
                .addStringOption(o => o.setName('size').setDescription('Tamaño').setRequired(true).addChoices({ name: 'Small', value: 'small' }, { name: 'Medium', value: 'medium' }, { name: 'Big', value: 'big' }))
                .addIntegerOption(o => o.setName('price').setDescription('Precio (100-500)').setMinValue(100).setMaxValue(500).setRequired(true))
                .addAttachmentOption(o => o.setName('image').setDescription('PNG Transparente').setRequired(true))
                .addStringOption(o => o.setName('emoji').setDescription('Emoji identificador').setRequired(true))) 
        // --- FIX ---
        .addSubcommand(subcommand =>
            subcommand.setName('fix').setDescription('🔧 Edita uno de tus cardholders.')
                .addStringOption(o => o.setName('code').setDescription('Elige el holder a editar (Autocompletado)').setRequired(true).setAutocomplete(true))
                .addStringOption(o => o.setName('new_name').setDescription('(Opcional) Nuevo nombre'))
                .addIntegerOption(o => o.setName('new_price').setDescription('(Opcional) Nuevo precio (100-500)').setMinValue(100).setMaxValue(500))
                .addStringOption(o => o.setName('new_emoji').setDescription('(Opcional) Nuevo emoji'))
                .addAttachmentOption(o => o.setName('new_image').setDescription('(Opcional) Nueva imagen PNG (Debe mantener tamaño original)')))
        // --- DELETE (Admin) ---
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
        // --- PREVIEW (NUEVO) ---
        .addSubcommand(subcommand =>
            subcommand.setName('preview').setDescription('👁️ Previsualiza cómo queda un marco en tu carta.')
                .addStringOption(o => o.setName('card_id').setDescription('ID de tu carta (ej. NJ.1234)').setRequired(true))
                .addStringOption(o => o.setName('holder_code').setDescription('ID del marco a probar').setRequired(true)))
        // --- USE ---
        .addSubcommand(subcommand =>
            subcommand.setName('use').setDescription('Ponerle un marco a una carta.')
                .addStringOption(o => o.setName('card_id').setDescription('ID de tu carta (ej. NJ.1234)').setRequired(true))
                .addStringOption(o => o.setName('holder_code').setDescription('ID del marco').setRequired(true)))
        // --- REMOVE ---
        .addSubcommand(subcommand =>
            subcommand.setName('remove').setDescription('Quitarle el marco a una carta.')
                .addStringOption(o => o.setName('card_id').setDescription('ID de tu carta').setRequired(true))),

    async autocomplete(interaction, supabase) {
        const focusedOption = interaction.options.getFocused(true);
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (subcommand === 'fix' && focusedOption.name === 'code') {
            const userValue = focusedOption.value.toLowerCase();
            const { data: myHolders } = await supabase.from('holders').select('code, name, emoji').eq('creator_id', userId).ilike('code', `%${userValue}%`).limit(25);
            if (!myHolders) return interaction.respond([]);
            return interaction.respond(myHolders.map(h => ({ name: `${h.emoji} ${h.code} — ${h.name}`, value: h.code })));
        }
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        try {
            // ======================================================
            // 👁️ PREVIEW (NUEVO)
            // ======================================================
            if (subcommand === 'preview') {
                await interaction.deferReply({ ephemeral: true }); // Respuesta privada
                const cardId = interaction.options.getString('card_id');
                const holderCode = interaction.options.getString('holder_code').toUpperCase();

                // 1. Buscar Carta (Base info + Rarity para tamaño)
                const { data: card } = await supabase.from('user_cards')
                    .select('base_cards(image_url, rarity, name)')
                    .eq('unique_card_id', cardId)
                    .eq('user_id', userId)
                    .single();

                if (!card) return interaction.editReply('❌ No tienes esa carta o no existe.');

                // 2. Buscar Holder
                const { data: holder } = await supabase.from('holders')
                    .select('image_url, size, name, emoji')
                    .eq('code', holderCode)
                    .single();

                if (!holder) return interaction.editReply('❌ Ese código de marco no existe.');

                // 3. Validar Tamaños
                let cardSize = 'small';
                if (card.base_cards.rarity === 2) cardSize = 'medium';
                if (card.base_cards.rarity === 3) cardSize = 'big';

                if (cardSize !== holder.size) {
                     return interaction.editReply(`⚠️ **Incompatible:** La carta es ${cardSize.toUpperCase()} y el marco es ${holder.size.toUpperCase()}. No se pueden combinar.`);
                }

                // 4. Generar Imagen con Canvas
                try {
                    const targetDims = SIZES[holder.size];
                    const canvas = createCanvas(targetDims.w, targetDims.h);
                    const ctx = canvas.getContext('2d');

                    // Cargar imágenes en paralelo
                    const [cardImg, holderImg] = await Promise.all([
                        loadImage(card.base_cards.image_url),
                        loadImage(holder.image_url)
                    ]);

                    // Dibujar: Carta abajo, Holder arriba
                    // Asumimos que las cartas base llenan el frame (como en single view)
                    ctx.drawImage(cardImg, 0, 0, targetDims.w, targetDims.h);
                    ctx.drawImage(holderImg, 0, 0, targetDims.w, targetDims.h);

                    const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: `preview-${holderCode}.png` });

                    const embed = new EmbedBuilder()
                        .setColor('#9b59b6')
                        .setTitle(`👁️ Previsualización: ${holder.emoji} ${holder.name}`)
                        .setDescription(`Así se vería en tu carta **${card.base_cards.name}** (\`${cardId}\`).`)
                        .setImage(`attachment://preview-${holderCode}.png`)
                        .setFooter({ text: 'Esto es solo una prueba. No has comprado ni equipado nada.' });

                    return interaction.editReply({ embeds: [embed], files: [attachment] });

                } catch (e) {
                    console.error("Error preview canvas:", e);
                    return interaction.editReply("❌ Ocurrió un error al generar la imagen de prueba. Asegúrate de que las imágenes sean válidas.");
                }
            }

            // ======================================================
            // ⛔ DELETE (ADMIN ONLY)
            // ======================================================
            if (subcommand === 'delete') {
                if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
                    return interaction.reply({ content: '⛔ Acceso Denegado.', ephemeral: true });
                }
                await interaction.deferReply({ ephemeral: true });
                const codeToDelete = interaction.options.getString('code').toUpperCase();
                const { data: holder } = await supabase.from('holders').select('id, name').eq('code', codeToDelete).single();
                if (!holder) return interaction.editReply(`❌ No encontrado: **${codeToDelete}**.`);
                const { error } = await supabase.from('holders').delete().eq('id', holder.id);
                if (error) throw error;
                return interaction.editReply(`✅ Eliminado de la base de datos: **${holder.name}** (\`${codeToDelete}\`).`);
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
                const emoji = interaction.options.getString('emoji');

                if (!/^[A-Z0-9]+$/.test(code)) return interaction.editReply('❌ Code: solo letras/números.');
                if (attachment.contentType !== 'image/png') return interaction.editReply('❌ Imagen: debe ser PNG.');

                const targetSize = SIZES[sizeKey];
                if (!attachment.width || attachment.width !== targetSize.w || attachment.height !== targetSize.h) {
                    return interaction.editReply(`❌ Medidas mal. Para **${sizeKey}** deben ser **${targetSize.w}x${targetSize.h}**.`);
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
            // 🔧 FIX
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
                    if (!newImage.width || newImage.width !== targetSize.w || newImage.height !== targetSize.h) return interaction.editReply(`❌ Medidas incorrectas. Deben ser **${targetSize.w}x${targetSize.h}** px.`);
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
                embed.setDescription(desc + 'Usa `/cardholder buy [code]` para comprar.\nUsa `/cardholder preview [card_id] [holder_code]` para probar.');
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
                if (!holder) return interaction.editReply('❌ No existe o no disponible.');

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

                let cardSize = 'small';
                if (card.base_cards.rarity === 2) cardSize = 'medium';
                if (card.base_cards.rarity === 3) cardSize = 'big';
                if (cardSize !== holderInfo.size) return interaction.editReply(`❌ Tamaños incompatibles: Carta **${cardSize}** vs Holder **${holderInfo.size}**.`);

                const { count: ownedCount } = await supabase.from('user_holders').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('holder_id', holderInfo.id);
                const { count: usedCount } = await supabase.from('user_cards').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('equipped_holder_id', holderInfo.id);

                if (!ownedCount || ownedCount <= usedCount) return interaction.editReply(`❌ No tienes copias libres de **${holderInfo.name}**. Compra más.`);

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
