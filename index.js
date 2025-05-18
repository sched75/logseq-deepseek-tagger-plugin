// L'import peut être commenté si vous n'utilisez pas de bundler/TS et que l'autocomplétion fonctionne sans
// import '@logseq/libs';

const DEEPSEEK_API_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions'; // Vérifiez l'endpoint exact

/**
 * Fonction pour appeler l'API DeepSeek et obtenir des suggestions de tags.
 * @param {string} textContent Le contenu du bloc pour lequel générer des tags.
 * @param {string} apiKey La clé API DeepSeek.
 * @returns {Promise<string[] | null>} Un tableau de tags suggérés par DeepSeek, ou null en cas d'erreur.
 */
async function fetchTagsFromDeepSeek(textContent, apiKey) {
  if (!apiKey) {
    console.error("Clé API DeepSeek non configurée.");
    logseq.App.showMsg("Veuillez configurer votre clé API DeepSeek dans les paramètres du plugin.", "error");
    return null;
  }

  // Obtenir la date du jour au format YYYY-MM-DD
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0'); // Mois de 0-11, donc +1. padStart pour "01", "02", ...
  const day = String(today.getDate()).padStart(2, '0');
  const currentDateString = `${year}-${month}-${day}`;

  // Votre prompt, avec les placeholders pour le texte et la date
  let promptTemplate = `Analyse le texte suivant et suggère 3 à 10 mots-clés ou concepts pertinents de un ou deux mots qui pourraient servir de tags. Retourne-les sous forme de liste séparée par des virgules, sans aucune autre introduction ni explication, chaque tag est donné en majuscule. Par exemple: "TECHNOLOGIE, INTELLIGENCE ARTIFICIELLE, FUTUR".
TU DOIS OBLIGATOIREMENT AJOUTER aux tags proposés, l'année (sur quatre chiffres), le mois (en Français et en majuscules), le mois (en français et en majuscules) avec l'année (e.g. FEVRIER 2025), le trimestre avec l'année (e.g. T1 2025), le quadrimestre avec l'année (e.g. Q1 2025), le semestre avec l'année (e.g. S1 2025). Les tags temporels doivent aussi être en majuscules.
Texte: "{TEXTE_DU_BLOC}"
Date pour référence temporelle: "${currentDateString}"
Tags suggérés:`;

  // Remplacer le placeholder {TEXTE_DU_BLOC}
  // Échapper les guillemets dans textContent pour éviter de casser la chaîne JSON du prompt
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
        model: "deepseek-chat", // ou "deepseek-coder" ou autre modèle pertinent
        messages: [
          { role: "user", content: finalPrompt }
        ],
        max_tokens: 150, // Augmenter un peu pour accommoder plus de tags + les temporels
        temperature: 0.2, // Température basse comme demandé
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
      // Enlever les guillemets potentiels autour de la liste entière de tags
      suggestedTagsString = suggestedTagsString.replace(/^["']|["']$/g, "");

      // Diviser en tableau, s'assurer que les tags sont en MAJUSCULES (même si demandé dans le prompt, une vérification est bien)
      // et qu'il n'y a pas de tags vides.
      return suggestedTagsString.split(',')
                                .map(tag => tag.trim().toUpperCase()) // Assurer MAJUSCULES et trim
                                .filter(tag => tag.length > 0);       // Filtrer les tags vides
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
  console.log("Plugin DeepSeek Tagger (Prompt V2) chargé !");

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

  logseq.Editor.registerSlashCommand(
    'tags',
    async (e) => {
      logseq.App.showMsg("Génération des tags...", "info", { timeout: 25000 });

      const apiKey = logseq.settings.deepseekApiKey;
      if (!apiKey || apiKey.trim() === "") {
        logseq.App.showMsg("Clé API DeepSeek non configurée. Allez dans les paramètres du plugin pour l'ajouter.", "error", { timeout: 10000 });
        return;
      }

      const parentBlock = await logseq.Editor.getBlock(e.uuid);
      if (!parentBlock) {
        logseq.App.showMsg("Impossible d'obtenir le bloc parent.", "warning");
        return;
      }

      let contentForAI = parentBlock.content;
      contentForAI = contentForAI.split('\n').filter(line => !line.trim().match(/^.+::/)).join('\n').trim();

      if (!contentForAI) {
        logseq.App.showMsg("Le bloc parent est vide (ou ne contient que des propriétés).", "warning");
        return;
      }

      const allTags = await fetchTagsFromDeepSeek(contentForAI, apiKey);

      if (allTags && allTags.length > 0) {
        const uniqueTags = [...new Set(allTags)];
        // CORRECTION DU FORMATAGE DES TAGS:
        // Les tags sont séparés par des virgules. Les espaces dans les tags sont conservés.
        // L'IA est censée donner les tags en MAJUSCULES.
        const tagsStringForChildBlock = uniqueTags.join(", ");
        // FIN DE LA CORRECTION DU FORMATAGE

        // CORRECTION ICI: Utiliser getBlock avec includeChildren
        const parentBlockWithChildren = await logseq.Editor.getBlock(parentBlock.uuid, { includeChildren: true });
        let tagsChildBlock = null;

        if (parentBlockWithChildren && parentBlockWithChildren.children && parentBlockWithChildren.children.length > 0) {
          tagsChildBlock = parentBlockWithChildren.children.find(child =>
            child.content && child.content.toUpperCase().startsWith("TAGS::")
          );
        }
        // FIN DE LA CORRECTION

        if (tagsChildBlock) {
          await logseq.Editor.updateBlock(tagsChildBlock.uuid, `tags:: ${tagsStringForChildBlock}`);
          logseq.App.showMsg("Tags (IA) mis à jour dans le bloc enfant !", "success");
        } else {
          await logseq.Editor.insertBlock(parentBlock.uuid, `tags:: ${tagsStringForChildBlock}`, { sibling: false, before: false });
          logseq.App.showMsg("Tags (IA) ajoutés dans un nouveau bloc enfant !", "success");
        }
      } else {
         logseq.App.showMsg("Aucun tag n'a pu être généré par DeepSeek ou une erreur est survenue.", "warning");
      }
    }
  );

  console.log("Commande /tags (Prompt V2) enregistrée.");
}

logseq.ready(main).catch(console.error);