// featuredImage, images, and ProductVariant.image are deprecated.
// featuredMedia and media are the replacements, and the Admin schema requires
// read_files, read_themes, and read_orders in addition to read_products.
// Those extra scopes are not granted. Keep the image fields until a scope
// change is approved, then replace them with media. Do not query inventory
// quantities: read_inventory is not granted either.

export const BUNDLE_PRODUCTS_QUERY = `#graphql
  query BundleProducts($ids: [ID!]!) {
    shop {
      currencyCode
    }
    nodes(ids: $ids) {
      __typename
      ... on Product {
        id
        title
        status
        featuredImage {
          url
          altText
        }
        options {
          id
          name
          values
        }
        images(first: 20) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            url
            altText
          }
        }
        variants(first: 100) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            availableForSale
            price
            compareAtPrice
            selectedOptions {
              name
              value
            }
            image {
              url
              altText
            }
          }
        }
      }
    }
  }
`;

export const BUNDLE_PRODUCTS_CONTEXT_QUERY = `#graphql
  query BundleProductsContext($ids: [ID!]!, $country: CountryCode!) {
    shop {
      currencyCode
    }
    nodes(ids: $ids) {
      __typename
      ... on Product {
        id
        title
        status
        featuredImage {
          url
          altText
        }
        options {
          id
          name
          values
        }
        images(first: 20) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            url
            altText
          }
        }
        variants(first: 100) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            availableForSale
            price
            compareAtPrice
            selectedOptions {
              name
              value
            }
            image {
              url
              altText
            }
            contextualPricing(context: { country: $country }) {
              price {
                amount
                currencyCode
              }
              compareAtPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;

export const BUNDLE_VARIANT_PAGE_QUERY = `#graphql
  query BundleVariantPage($id: ID!, $cursor: String) {
    product(id: $id) {
      id
      variants(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          availableForSale
          price
          compareAtPrice
          selectedOptions {
            name
            value
          }
          image {
            url
            altText
          }
        }
      }
    }
  }
`;

export const BUNDLE_VARIANT_PAGE_CONTEXT_QUERY = `#graphql
  query BundleVariantPageContext($id: ID!, $cursor: String, $country: CountryCode!) {
    product(id: $id) {
      id
      variants(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          availableForSale
          price
          compareAtPrice
          selectedOptions {
            name
            value
          }
          image {
            url
            altText
          }
          contextualPricing(context: { country: $country }) {
            price {
              amount
              currencyCode
            }
            compareAtPrice {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

export const BUNDLE_COLLECTION_PRODUCTS_QUERY = `#graphql
  query BundleCollectionProducts($id: ID!, $cursor: String) {
    collection(id: $id) {
      id
      title
      products(first: 50, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          status
          featuredImage {
            url
            altText
          }
          variants(first: 100) {
            pageInfo {
              hasNextPage
            }
            nodes {
              id
              title
              availableForSale
            }
          }
        }
      }
    }
  }
`;

export const BUNDLE_PRODUCT_IMAGES_QUERY = `#graphql
  query BundleProductImages($id: ID!, $after: String) {
    product(id: $id) {
      id
      images(first: 20, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          url
          altText
        }
      }
    }
  }
`;

export const BUNDLE_COLLECTION_MEMBERSHIP_QUERY = `#graphql
  query BundleCollectionMembership($id: ID!, $productId: ID!) {
    collection(id: $id) {
      id
      hasProduct(id: $productId)
    }
  }
`;
