// index.js

const DEEPSEEK_API_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions'; // Vérifiez l'endpoint exact

/**
 * Fonction pour appeler l'API DeepSeek et obtenir des suggestions de tags.
 * @param {string} textContent Le contenu du bloc pour lequel générer des tags.
 * @param {string} apiKey La clé API DeepSeek.
 * @returns {Promise<string[] | null>} Un tableau de tags suggérés par DeepSeek, ou null en cas d'erreur.
 */
async function fetchTagsFromDeepSeek(textContent, apiKey) {
  if (!apiKey || apiKey.trim() === "") {
    console.error("Clé API DeepSeek non configurée.");
    logseq.App.showMsg("Veuillez configurer votre clé API DeepSeek dans les paramètres du plugin.", "error");
    return null;
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const currentDateString = `${year}-${month}-${day}`;

  let promptTemplate = `Analyse le texte suivant et suggère 3 à 10 mots-clés ou concepts pertinents de un ou deux mots qui pourraient servir de tags. Retourne-les sous forme de liste séparée par des virgules, sans aucune autre introduction ni explication, chaque tag est donné en majuscule. Par exemple: "TECHNOLOGIE, INTELLIGENCE ARTIFICIELLE, FUTUR".
TU DOIS OBLIGATOIREMENT AJOUTER aux tags proposés, l'année (sur quatre chiffres), le mois (en Français et en majuscules), le mois (en français et en majuscules) avec l'année (e.g. FEVRIER 2025), le trimestre avec l'année (e.g. T1 2025), le quadrimestre avec l'année (e.g. Q1 2025), le semestre avec l'année (e.g. S1 2025). Les tags temporels doivent aussi être en majuscules.
Texte: "{TEXTE_DU_BLOC}"
Date pour référence temporelle: "${currentDateString}"
Tags suggérés:`;

  const escapedTextContent = textContent.replace(/"/g, '\\"');
  const finalPrompt = promptTemplate.replace("{TEXTE_DU_BLOC}", escapedTextContent);

  try {
    const response = await fetch(DEEPSEEK_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "user", content: finalPrompt }
        ],
        max_tokens: 150,
        temperature: 0.2,
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error("Erreur API DeepSeek:", response.status, errorData, "Prompt envoyé:", finalPrompt);
      logseq.App.showMsg(`Erreur de l'API DeepSeek: ${errorData.error?.message || response.statusText}`, "error");
      return null;
    }

    const data = await response.json();
    if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
      let suggestedTagsString = data.choices[0].message.content.trim();
      suggestedTagsString = suggestedTagsString.replace(/^["']|["']$/g, "");
      return suggestedTagsString.split(',')
                                .map(tag => tag.trim().toUpperCase())
                                .filter(tag => tag.length > 0);
    } else {
      console.error("Réponse inattendue de DeepSeek:", data, "Prompt envoyé:", finalPrompt);
      logseq.App.showMsg("Format de réponse inattendu de DeepSeek.", "warning");
      return null;
    }
  } catch (error) {
    console.error("Erreur lors de l'appel à DeepSeek:", error, "Prompt envoyé:", finalPrompt);
    logseq.App.showMsg(`Erreur de connexion à DeepSeek: ${error.message}`, "error");
    return null;
  }
}

/**
 * Point d'entrée principal du plugin.
 */
function main() {
  console.log("Plugin DeepSeek Tagger (Complet) chargé !");

  const settingsSchema = [
    {
      key: "deepseekApiKey",
      type: "string",
      title: "Clé API DeepSeek",
      description: "Entrez votre clé API DeepSeek. Elle sera stockée localement.",
      default: "",
    }
  ];
  logseq.useSettingsSchema(settingsSchema);

  // --- Helper: Fonction pour insérer ou mettre à jour le bloc de tags ENFANT ---
  async function insertOrUpdateTagsChildBlock(parentBlockUUID, tagsArray) {
    if (!tagsArray || tagsArray.length === 0) {
      logseq.App.showMsg("Aucun tag à insérer.", "info");
      return;
    }
    // S'assurer de l'unicité et du formatage MAJUSCULES avant de joindre
    const uniqueTags = [...new Set(tagsArray.map(tag => tag.trim().toUpperCase()))].filter(tag => tag.length > 0);
    if (uniqueTags.length === 0) {
        logseq.App.showMsg("Aucun tag valide à insérer après nettoyage.", "info");
        return;
    }
    const tagsStringForBlock = uniqueTags.join(", ");

    const parentBlockWithChildren = await logseq.Editor.getBlock(parentBlockUUID, { includeChildren: true });
    let tagsChildBlock = null;

    if (parentBlockWithChildren && parentBlockWithChildren.children && parentBlockWithChildren.children.length > 0) {
      tagsChildBlock = parentBlockWithChildren.children.find(child =>
        child.content && child.content.toUpperCase().startsWith("TAGS::") // Recherche insensible à la casse
      );
    }

    if (tagsChildBlock) {
      await logseq.Editor.updateBlock(tagsChildBlock.uuid, `tags:: ${tagsStringForBlock}`);
      logseq.App.showMsg("Tags mis à jour dans le bloc enfant !", "success");
    } else {
      await logseq.Editor.insertBlock(parentBlockUUID, `tags:: ${tagsStringForBlock}`, { sibling: false, before: false });
      logseq.App.showMsg("Tags ajoutés dans un nouveau bloc enfant !", "success");
    }
  }

  // --- Commande /tags (pour le bloc actuel, utilise un enfant) ---
  logseq.Editor.registerSlashCommand(
    'tags',
    async (e) => {
      logseq.App.showMsg("Génération des tags pour le bloc...", "info", { timeout: 25000 });
      const apiKey = logseq.settings.deepseekApiKey;
      if (!apiKey || apiKey.trim() === "") {
        logseq.App.showMsg("Clé API DeepSeek non configurée.", "error"); return;
      }
      const currentBlock = await logseq.Editor.getBlock(e.uuid);
      if (!currentBlock) {
        logseq.App.showMsg("Impossible d'obtenir le bloc actuel.", "warning"); return;
      }
      let contentForAI = currentBlock.content.split('\n').filter(line => !line.trim().match(/^.+::/)).join('\n').trim();
      if (!contentForAI) {
        logseq.App.showMsg("Le bloc est vide (ou ne contient que des propriétés).", "warning"); return;
      }
      const allTags = await fetchTagsFromDeepSeek(contentForAI, apiKey);
      if (allTags) {
        await insertOrUpdateTagsChildBlock(currentBlock.uuid, allTags);
      } else {
        // Le message d'erreur spécifique a déjà été affiché par fetchTagsFromDeepSeek
        // logseq.App.showMsg("Aucun tag n'a pu être généré pour le bloc.", "warning");
      }
    }
  );
  console.log("Commande /tags (bloc) enregistrée.");

  // --- Commande /tagpage (pour la page actuelle, nouveau bloc en bas) ---
  logseq.Editor.registerSlashCommand(
    'tagpage',
    async () => {
      logseq.App.showMsg("Génération des tags pour la page...", "info", { timeout: 45000 });
      const apiKey = logseq.settings.deepseekApiKey;
      if (!apiKey || apiKey.trim() === "") {
        logseq.App.showMsg("Clé API DeepSeek non configurée.", "error"); return;
      }

      const currentPage = await logseq.Editor.getCurrentPage();
      if (!currentPage || !currentPage.name) {
        logseq.App.showMsg("Impossible de déterminer la page actuelle.", "warning"); return;
      }

      const pageBlocks = await logseq.Editor.getPageBlocksTree(currentPage.name);
      if (!pageBlocks || pageBlocks.length === 0) {
        logseq.App.showMsg("La page est vide ou n'a pas de blocs.", "info"); return;
      }

      let pageContent = "";
      function extractContent(blocks) {
        for (const block of blocks) {
          if (block.content) {
            const lines = block.content.split('\n');
            const relevantContent = lines
              .filter(line => !line.trim().match(/^.+::/i) && !line.trim().toUpperCase().startsWith("TAGS::"))
              .join('\n');
            if (relevantContent.trim()) {
                pageContent += relevantContent.trim() + "\n\n";
            }
          }
          // Optionnel : Récursion pour enfants (non activé pour l'instant)
          // if (block.children && block.children.length > 0) {
          //   extractContent(block.children);
          // }
        }
      }
      extractContent(pageBlocks);
      pageContent = pageContent.trim();

      if (!pageContent) {
        logseq.App.showMsg("Aucun contenu textuel pertinent trouvé sur la page.", "info"); return;
      }

      const MAX_CONTENT_LENGTH = 15000;
      if (pageContent.length > MAX_CONTENT_LENGTH) {
        pageContent = pageContent.substring(0, MAX_CONTENT_LENGTH) + "\n[... contenu tronqué ...]";
        logseq.App.showMsg("Contenu de la page tronqué pour l'analyse des tags.", "info", {timeout: 5000});
      }

      const allTagsArray = await fetchTagsFromDeepSeek(pageContent, apiKey);

      if (allTagsArray && allTagsArray.length > 0) {
        const uniqueTags = [...new Set(allTagsArray.map(tag => tag.trim().toUpperCase()))].filter(tag => tag.length > 0);
        if (uniqueTags.length === 0) {
            logseq.App.showMsg("Aucun tag valide à insérer après nettoyage.", "info"); return;
        }
        const tagsStringForBlock = uniqueTags.join(", ");
        const newBlockContent = `Page Tags:: ${tagsStringForBlock}`; // Préfixe pour clarté

        const lastRootBlock = pageBlocks[pageBlocks.length - 1];
        if (lastRootBlock && lastRootBlock.uuid) {
            await logseq.Editor.insertBlock(lastRootBlock.uuid, newBlockContent, { sibling: true, before: false });
            logseq.App.showMsg("Tags de la page ajoutés dans un nouveau bloc en bas de page !", "success");
        } else {
            // Fallback si lastRootBlock n'est pas trouvé (ex: page avec uniquement des propriétés, page vide après filtrage)
            try {
                 await logseq.Editor.insertBatchBlock([{
                    pageName: currentPage.name,
                    content: newBlockContent
                }], { sibling: false }); // sibling: false par rapport à la page signifie enfant direct de la page
                 logseq.App.showMsg("Tags de la page ajoutés dans un nouveau bloc (méthode de repli) !", "success");
            } catch (batchError) {
                console.error("Erreur lors de l'insertion en batch pour tagpage:", batchError);
                logseq.App.showMsg("Erreur lors de l'ajout des tags de page.", "error");
            }
        }
      } else {
        // Message d'erreur déjà géré par fetchTagsFromDeepSeek ou si allTagsArray est vide
      }
    }
  );
  console.log("Commande /tagpage enregistrée.");

  // --- Commande /tagselect (pour la sélection actuelle, nouveau bloc après bloc courant) ---
  logseq.Editor.registerSlashCommand(
    'tagselect',
    async (e) => {
      logseq.App.showMsg("Génération des tags pour la sélection...", "info", { timeout: 25000 });
      const apiKey = logseq.settings.deepseekApiKey;
      if (!apiKey || apiKey.trim() === "") {
        logseq.App.showMsg("Clé API DeepSeek non configurée.", "error"); return;
      }

      const selection = await logseq.Editor.getEditingCursorSelection();
      if (!selection || !selection.text || selection.text.trim() === "") {
        logseq.App.showMsg("Aucune sélection de texte trouvée ou la sélection est vide.", "warning"); return;
      }

      const selectedText = selection.text.trim();
      const allTagsArray = await fetchTagsFromDeepSeek(selectedText, apiKey);

      if (allTagsArray && allTagsArray.length > 0) {
        const uniqueTags = [...new Set(allTagsArray.map(tag => tag.trim().toUpperCase()))].filter(tag => tag.length > 0);
         if (uniqueTags.length === 0) {
            logseq.App.showMsg("Aucun tag valide à insérer après nettoyage.", "info"); return;
        }
        const tagsStringForBlock = uniqueTags.join(", ");
        const newBlockContent = `Selection Tags:: ${tagsStringForBlock}`; // Préfixe pour clarté

        await logseq.Editor.insertBlock(e.uuid, newBlockContent, { sibling: true, before: false });
        logseq.App.showMsg("Tags de la sélection ajoutés dans un nouveau bloc !", "success");
      } else {
        // Message d'erreur déjà géré par fetchTagsFromDeepSeek ou si allTagsArray est vide
      }
    }
  );
  console.log("Commande /tagselect enregistrée.");
}

// Démarre le plugin
logseq.ready(main).catch(console.error);