import Foundation
import NaturalLanguage
import CoreGraphics

@main
struct TextProcessingRegression {
    private static var failures: [String] = []

    static func main() {
        expect(
            name: "cross-page hyphen",
            input: [
                "The evaluation uses mea-",
                "sures that remain robust."
            ],
            output: ["The evaluation uses measures that remain robust."]
        )

        expect(
            name: "incomplete phrase",
            input: [
                "Data augmentation is important. In case of",
                "touching cells, the border receives a larger weight."
            ],
            output: [
                "Data augmentation is important. In case of touching cells, the border receives a larger weight."
            ]
        )

        expect(
            name: "citation ending",
            input: [
                "The method follows prior work. [12]",
                "A new visual paragraph begins here."
            ],
            output: [
                "The method follows prior work. [12]",
                "A new visual paragraph begins here."
            ]
        )

        expect(
            name: "numbered section",
            input: [
                "The most common approach is described here3. The Distributional Bellman Operators This section introduces the full distribution.",
                "The next paragraph remains separate."
            ],
            output: [
                "The most common approach is described here",
                "3. The Distributional Bellman Operators This section introduces the full distribution.",
                "The next paragraph remains separate."
            ]
        )

        expect(
            name: "compound hyphen",
            input: [
                "This is a state-of-the-",
                "art model."
            ],
            output: ["This is a state-of-the-art model."]
        )

        expect(
            name: "compound suffix hyphen",
            input: [
                "We use a model-",
                "based objective."
            ],
            output: ["We use a model-based objective."]
        )

        expect(
            name: "spaced PDF word fragments",
            input: [
                "The natu- ral mea- sure lets our model out- perform the baseline and supports re- search."
            ],
            output: [
                "The natural measure lets our model outperform the baseline and supports research."
            ]
        )

        expect(
            name: "spaced PDF compound fragments",
            input: [
                "We compare a well- known model- based method with T- cell data and end- to-end training."
            ],
            output: [
                "We compare a well-known model-based method with T-cell data and end-to-end training."
            ]
        )

        let headingOutput = TextProcessing.postProcessParagraphs([
            "Loss Function",
            "The loss combines two terms."
        ])
        check(
            headingOutput.joined(separator: " ").contains("Loss Function"),
            "short heading preservation",
            actual: headingOutput
        )

        let sectionLayoutOutput = TextProcessing.postProcessParagraphs([
            "1 Introduction",
            "Our model outperforms prior work while preserving complete sentences."
        ])
        check(
            sectionLayoutOutput == [
                "1 Introduction\nOur model outperforms prior work while preserving complete sentences."
            ],
            "section heading layout",
            actual: sectionLayoutOutput
        )

        let inlineSectionLayoutOutput = TextProcessing.postProcessParagraphs([
            "INTRODUCTION. The paper begins with a complete overview of the scientific problem."
        ])
        check(
            inlineSectionLayoutOutput == [
                "INTRODUCTION.\nThe paper begins with a complete overview of the scientific problem."
            ],
            "inline section heading layout",
            actual: inlineSectionLayoutOutput
        )

        let ordinaryIntroductionSentence = TextProcessing.postProcessParagraphs([
            "Introduction to machine learning methods requires careful definitions and examples."
        ])
        check(
            ordinaryIntroductionSentence == [
                "Introduction to machine learning methods requires careful definitions and examples."
            ],
            "ordinary introduction sentence",
            actual: ordinaryIntroductionSentence
        )

        let sectionEquationLayoutOutput = TextProcessing.postProcessParagraphs([
            "2 Methods",
            "The derivation ends with the following compact expression.",
            "E = mc2"
        ])
        check(
            sectionEquationLayoutOutput == [
                "2 Methods\nThe derivation ends with the following compact expression.\nE = mc2"
            ],
            "section equation layout",
            actual: sectionEquationLayoutOutput
        )

        let stitchedPages = TextProcessing.stitchPageParagraphs([
            ["The loss is evaluated independently for every foreground pixel"],
            ["This weighting improves separation near object boundaries."]
        ])
        check(
            stitchedPages == [
                "The loss is evaluated independently for every foreground pixel This weighting improves separation near object boundaries."
            ],
            "uppercase page continuation",
            actual: stitchedPages
        )

        let headingBoundary = TextProcessing.stitchPageParagraphs([
            ["The previous experiment is complete."],
            ["3 Results", "The measurements are reported here."]
        ])
        check(
            headingBoundary == [
                "The previous experiment is complete.",
                "3 Results",
                "The measurements are reported here."
            ],
            "page heading boundary",
            actual: headingBoundary
        )

        let equationOutput = TextProcessing.postProcessParagraphs([
            "The operator is defined below:",
            "T pi Z = R + gamma P pi Z",
            "The fixed point is then analyzed."
        ])
        check(
            equationOutput.joined(separator: " ").contains("T pi Z = R + gamma P pi Z"),
            "equation preservation",
            actual: equationOutput
        )

        let visualRunOutput = TextProcessing.postProcessParagraphs([
            "The architecture is shown in the next figure.",
            "Protein",
            "Diffusible",
            "Nascent",
            "RNA +RNA DNA",
            "Mechanism",
            "The main experiment begins here."
        ])
        check(
            visualRunOutput.joined(separator: " ").contains("Protein") == false &&
                visualRunOutput.joined(separator: " ").contains("The main experiment begins here."),
            "visual artifact run",
            actual: visualRunOutput
        )

        let denseNumericOutput = TextProcessing.postProcessParagraphs([
            "The chromosome contacts are shown below.",
            "1 1 1 2 2 2 3 3 3 4 4 4 5 5 5 6 6 6 7 7 7 8 8 8 9 9 9 10 10 10",
            "The biological interpretation follows."
        ])
        check(
            denseNumericOutput.joined(separator: " ").contains("1 1 1 2 2 2") == false &&
                denseNumericOutput.joined(separator: " ").contains("The biological interpretation follows."),
            "dense numeric artifact",
            actual: denseNumericOutput
        )

        let equationRunOutput = TextProcessing.postProcessParagraphs([
            "a = b + c",
            "d = e + f",
            "g = h + i",
            "j = k + l",
            "m = n + o"
        ])
        check(
            equationRunOutput.joined(separator: " ").contains("a = b + c") &&
                equationRunOutput.joined(separator: " ").contains("m = n + o"),
            "equation run preservation",
            actual: equationRunOutput
        )

        let panelCaptionOutput = TextProcessing.postProcessParagraphs([
            "A B C D",
            "Figure 1. Overview of the proposed architecture."
        ])
        check(
            panelCaptionOutput == ["A B C D Figure 1. Overview of the proposed architecture."],
            "panel labels with caption",
            actual: panelCaptionOutput
        )

        let splitPanelCaptionOutput = TextProcessing.postProcessParagraphs([
            "A",
            "B",
            "C D Figure 1. Overview of the proposed architecture."
        ])
        check(
            splitPanelCaptionOutput == ["A B C D Figure 1. Overview of the proposed architecture."],
            "split panel labels with caption",
            actual: splitPanelCaptionOutput
        )

        let standalonePanelLabels = TextProcessing.postProcessParagraphs([
            "The architecture is described in the paper.",
            "A B",
            "The evaluation begins in the next paragraph."
        ])
        check(
            standalonePanelLabels.contains("A B") == false,
            "standalone panel labels",
            actual: standalonePanelLabels
        )

        let boilerplateOutput = TextProcessing.postProcessParagraphs([
            "The study begins here.",
            "Cell 184, 5775-5790, November 11, 2021 © 2021 Elsevier Inc.",
            "The next paragraph continues the study."
        ])
        check(
            boilerplateOutput == [
                "The study begins here.",
                "The next paragraph continues the study."
            ],
            "publication boilerplate",
            actual: boilerplateOutput
        )

        let abbreviationSentences = TextProcessing.splitIntoSentences(
            "As shown in Fig. 2, the model improves. The result remains stable."
        )
        check(
            abbreviationSentences.first?.contains("Fig. 2") == true,
            "academic abbreviation",
            actual: abbreviationSentences
        )

        let middleReferences = TextProcessing.excludeReferenceSection(from: [
            "Abstract. This paper introduces the method.",
            "Introduction. The problem is important.",
            "Results. The model improves accuracy.",
            "Discussion. The result is robust.",
            "References",
            "Smith, J. (2020). A useful paper. Journal 1, 1-10.",
            "Jones, A. (2021). Another paper. Journal 2, 11-20.",
            "STAR METHODS",
            "RESOURCE AVAILABILITY. Materials are available on request.",
            "The experiments used three independent replicates."
        ])
        check(
            middleReferences.referenceParagraphs.count == 3 &&
                middleReferences.bodyParagraphs.contains("STAR METHODS") &&
                middleReferences.bodyParagraphs.contains("The experiments used three independent replicates."),
            "middle reference section",
            actual: middleReferences.bodyParagraphs
        )

        let referencesBeforeFormattedMethods = TextProcessing.excludeReferenceSection(from: [
            "Abstract. This paper introduces the method.",
            "Introduction. The problem is important.",
            "Results. The model improves accuracy.",
            "References",
            "Smith, J. (2020). A useful paper. Journal 1, 1-10.",
            "Jones, A. (2021). Another paper. Journal 2, 11-20.",
            "METHOD\nThe experiments used three independent replicates.",
            "Data were analyzed with a predefined statistical plan."
        ])
        check(
            referencesBeforeFormattedMethods.referenceParagraphs.count == 3 &&
                referencesBeforeFormattedMethods.bodyParagraphs.contains(
                    "METHOD\nThe experiments used three independent replicates."
                ),
            "formatted post-reference methods",
            actual: referencesBeforeFormattedMethods.bodyParagraphs
        )

        if failures.isEmpty {
            print("TextProcessing regression tests passed.")
        } else {
            for failure in failures {
                fputs("FAIL: \(failure)\n", stderr)
            }
            exit(1)
        }
    }

    private static func expect(name: String, input: [String], output: [String]) {
        let actual = TextProcessing.postProcessParagraphs(input)
        check(actual == output, name, actual: actual)
    }

    private static func check(_ condition: Bool, _ name: String, actual: [String]) {
        if !condition {
            failures.append("\(name) produced \(actual)")
        }
    }
}
